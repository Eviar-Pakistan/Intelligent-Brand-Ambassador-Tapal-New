from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db.models import Q
from rest_framework import serializers

from .models import (
    Ambassador,
    AmbassadorComplaint,
    BackupCoverage,
    AssessmentAnswer,
    AssessmentQuestion,
    AssessmentSession,
    Consumer,
    PlatformSettings,
    MonthlyShift,
    ShiftAssignment,
    Store,
    StoreReward,
    SurveyQuestion,
    TrainingVideo,
)
from .shifts import day_key_for, label_from_times, monthly_status, parse_month, peak_matches


def _pct(n: int, d: int) -> float:
    if d <= 0:
        return 0.0
    return round(100.0 * n / d, 1)


class RoundingDecimalField(serializers.DecimalField):
    """Accepts map coordinates with extra decimal places and stores them rounded."""

    def to_internal_value(self, data):
        if data is None or isinstance(data, bool):
            return super().to_internal_value(data)
        text = str(data).strip()
        if text == '':
            return super().to_internal_value(data)
        try:
            value = Decimal(text)
        except Exception:
            return super().to_internal_value(data)
        places = self.decimal_places if self.decimal_places is not None else 6
        rounded = value.quantize(Decimal('1').scaleb(-places), rounding=ROUND_HALF_UP)
        return super().to_internal_value(format(rounded, 'f'))


class StoreSerializer(serializers.ModelSerializer):
    created_by_email = serializers.EmailField(source='created_by.email', read_only=True)
    shopper_url = serializers.SerializerMethodField()
    qr_image_url = serializers.SerializerMethodField()
    shopper_count = serializers.SerializerMethodField()
    engagement = serializers.SerializerMethodField()
    conversion = serializers.SerializerMethodField()
    assigned_bas = serializers.SerializerMethodField()
    peak = serializers.SerializerMethodField()
    latitude = RoundingDecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
    longitude = RoundingDecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)

    class Meta:
        model = Store
        fields = (
            'id',
            'store_code',
            'name',
            'city',
            'address',
            'footfall',
            'peak_hours',
            'peak',
            'contact_name',
            'contact_phone',
            'status',
            'coverage',
            'bas',
            'assigned_bas',
            'today_footfall',
            'shopper_count',
            'engagement',
            'conversion',
            'latitude',
            'longitude',
            'qr_slug',
            'shopper_url',
            'qr_image_url',
            'created_by',
            'created_by_email',
            'created_at',
            'updated_at',
        )
        extra_kwargs = {
            'address': {'allow_blank': True, 'required': False},
            'store_code': {'allow_blank': True, 'required': False},
        }
        read_only_fields = (
            'id',
            'qr_slug',
            'shopper_url',
            'qr_image_url',
            'peak',
            'assigned_bas',
            'shopper_count',
            'engagement',
            'conversion',
            'created_by',
            'created_by_email',
            'created_at',
            'updated_at',
        )

    def validate_store_code(self, value):
        return (value or '').strip().upper()

    def get_shopper_url(self, obj):
        return obj.shopper_url

    def get_qr_image_url(self, obj):
        if not obj.qr_image:
            return None
        request = self.context.get('request')
        url = obj.qr_image.url
        if request:
            return request.build_absolute_uri(url)
        media_host = getattr(settings, 'SHOPPER_QR_BASE_URL', 'http://localhost:8000').rstrip('/')
        return f'{media_host}{url}'

    def get_peak(self, obj):
        raw = (obj.peak_hours or '').strip()
        if not raw:
            return []
        parts = [p.strip() for p in raw.replace(';', ',').split(',') if p.strip()]
        return parts or [raw]

    def get_shopper_count(self, obj):
        annotated = getattr(obj, 'shopper_count_ann', None)
        if annotated is not None:
            return int(annotated)
        return obj.consumers.count()

    def get_assigned_bas(self, obj):
        annotated = getattr(obj, 'assigned_bas_ann', None)
        if annotated is not None:
            return int(annotated)
        return obj.ambassadors.filter(
            status__in=(Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED)
        ).count()

    def get_engagement(self, obj):
        # engaged = shopper survey sessions + shoppers the BA intercepted
        shoppers = self.get_shopper_count(obj) + self._interceptions().get(obj.pk, [0, 0])[1]
        footfall = obj.today_footfall or 0
        if footfall > 0:
            return min(100.0, _pct(shoppers, footfall))
        return 100.0 if shoppers else 0.0

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Status, coverage and BAs come from this month's shifts and today's check-ins.
        live = self.context.get('_store_live')
        if live is None or instance.pk not in live:
            from .store_live import live_store_stats

            ids = list(Store.objects.values_list('id', flat=True)) if live is None else [instance.pk]
            live = {**(live or {}), **live_store_stats(ids)}
            self.context['_store_live'] = live
        stats = live.get(instance.pk)
        if stats:
            data.update(
                {
                    'status': stats['status'],
                    'coverage': stats['coverage'],
                    'bas': stats['bas'],
                    'assigned_bas': stats['bas'],
                    'assigned': stats['assigned'],
                    'scheduled_today': stats['scheduled_today'],
                    'checked_in_today': stats['checked_in_today'],
                }
            )
        data['footfall_date'] = instance.footfall_date.isoformat() if instance.footfall_date else None
        return data

    def _interceptions(self):
        cache = self.context.setdefault('_store_conversion_cache', {})
        if 'interceptions' not in cache:
            from .store_live import interception_counts

            cache['interceptions'] = interception_counts()[0]
        return cache['interceptions']

    def get_conversion(self, obj):
        # Shoppers who switched to Tapal / shoppers engaged (BA interceptions + survey 'Yes').
        switched, intercepted = self._interceptions().get(obj.pk, [0, 0])
        cache = self.context.setdefault('_store_conversion_cache', {})
        if 'switch_id' not in cache:
            q = SurveyQuestion.objects.filter(is_active=True, order=5).first()
            cache['switch_id'] = str(q.id) if q else None
        switch_id = cache['switch_id']
        consumers = list(obj.consumers.only('answers', 'feedback_rating'))
        if not consumers:
            return _pct(switched, intercepted) if intercepted else 0.0
        if switch_id:
            answered = intercepted
            yes = switched
            for c in consumers:
                ans = c.answers if isinstance(c.answers, dict) else {}
                val = str(ans.get(switch_id, ''))
                if not val:
                    continue
                answered += 1
                if val.lower().startswith('yes'):
                    yes += 1
            if answered:
                return _pct(yes, answered)
        if intercepted:
            return _pct(switched, intercepted)
        with_feedback = sum(1 for c in consumers if c.feedback_rating is not None)
        return _pct(with_feedback, len(consumers))

    def validate_latitude(self, value):
        if value is None:
            return value
        if value < -90 or value > 90:
            raise serializers.ValidationError('Latitude must be between -90 and 90.')
        return value

    def validate_longitude(self, value):
        if value is None:
            return value
        if value < -180 or value > 180:
            raise serializers.ValidationError('Longitude must be between -180 and 180.')
        return value


class StoreRewardSerializer(serializers.ModelSerializer):
    store_name = serializers.CharField(source='store.name', read_only=True)

    class Meta:
        model = StoreReward
        fields = (
            'id',
            'store',
            'store_name',
            'label',
            'win_amount',
            'win_detail',
            'promo_code',
            'is_active',
            'is_featured',
            'sort_order',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'store_name', 'created_at', 'updated_at')

    def validate_store(self, value):
        if value is None:
            raise serializers.ValidationError('Store is required.')
        return value

    def create(self, validated_data):
        reward = super().create(validated_data)
        if reward.is_featured:
            StoreReward.objects.filter(store=reward.store, is_featured=True).exclude(pk=reward.pk).update(
                is_featured=False
            )
        return reward

    def update(self, instance, validated_data):
        reward = super().update(instance, validated_data)
        if reward.is_featured:
            StoreReward.objects.filter(store=reward.store, is_featured=True).exclude(pk=reward.pk).update(
                is_featured=False
            )
        return reward


class SurveyQuestionSerializer(serializers.ModelSerializer):
    store_name = serializers.CharField(source='store.name', read_only=True)

    class Meta:
        model = SurveyQuestion
        fields = ('id', 'store', 'store_name', 'order', 'text', 'options', 'is_active', 'created_at')
        read_only_fields = ('id', 'store_name', 'created_at')

    def validate_text(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Question text is required.')
        return value

    def validate_options(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Options must be a list.')
        options = [str(option).strip() for option in value if str(option).strip()]
        if len(options) < 2:
            raise serializers.ValidationError('Add at least two answer options.')
        if len(options) != len(set(options)):
            raise serializers.ValidationError('Answer options must be unique.')
        return options


class AmbassadorComplaintSerializer(serializers.ModelSerializer):
    ambassador_name = serializers.CharField(source='ambassador.name', read_only=True)
    store_name = serializers.CharField(source='store.name', read_only=True)
    store_city = serializers.CharField(source='store.city', read_only=True)

    class Meta:
        model = AmbassadorComplaint
        fields = (
            'id', 'ambassador', 'ambassador_name', 'store', 'store_name', 'store_city',
            'complaint', 'status', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'ambassador', 'ambassador_name', 'store_name', 'store_city', 'created_at', 'updated_at')


class ConsumerCreateSerializer(serializers.Serializer):
    store_slug = serializers.SlugField()
    consent = serializers.BooleanField()
    name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=30)
    answers = serializers.DictField(
        child=serializers.CharField(allow_blank=False, max_length=300),
        allow_empty=False,
    )

    def validate_consent(self, value):
        if not value:
            raise serializers.ValidationError('Consent is required.')
        return value

    def validate(self, attrs):
        store = Store.objects.filter(qr_slug=attrs['store_slug']).first()
        if not store:
            raise serializers.ValidationError({'store_slug': 'Store not found.'})
        attrs['store'] = store

        store_questions = SurveyQuestion.objects.filter(is_active=True, store=store)
        # Stores with questions published by HO use only their own question set.
        # Legacy global questions preserve existing shopper journeys until a store is configured.
        active_questions = store_questions if store_questions.exists() else SurveyQuestion.objects.filter(
            is_active=True, store__isnull=True
        )
        questions = {
            str(q.id): q
            for q in active_questions
        }
        if not questions:
            raise serializers.ValidationError('No survey questions configured.')

        answers = attrs['answers']
        # Accept keys as question ids (str or int-like)
        normalized = {}
        for key, value in answers.items():
            qid = str(key)
            question = questions.get(qid)
            if not question:
                raise serializers.ValidationError({'answers': f'Unknown question id: {key}'})
            if value not in question.options:
                raise serializers.ValidationError(
                    {'answers': f'Invalid option for question {question.order}: {value}'}
                )
            normalized[qid] = value

        missing = [qid for qid in questions if qid not in normalized]
        if missing:
            raise serializers.ValidationError(
                {'answers': f'Please answer all questions. Missing: {", ".join(missing)}'}
            )

        attrs['answers'] = normalized
        return attrs

    def create(self, validated_data):
        return Consumer.objects.create(
            store=validated_data['store'],
            consent=validated_data['consent'],
            name=validated_data.get('name', ''),
            phone=validated_data.get('phone', ''),
            answers=validated_data['answers'],
        )


class ConsumerSerializer(serializers.ModelSerializer):
    store_name = serializers.CharField(source='store.name', read_only=True)
    store_slug = serializers.SlugField(source='store.qr_slug', read_only=True)

    class Meta:
        model = Consumer
        fields = (
            'id',
            'store',
            'store_name',
            'store_slug',
            'name',
            'phone',
            'consent',
            'answers',
            'feedback_rating',
            'feedback_comment',
            'created_at',
            'updated_at',
        )
        read_only_fields = fields


class TrainingVideoSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    uploaded_by_email = serializers.EmailField(source='uploaded_by.email', read_only=True)
    ready = serializers.SerializerMethodField()
    transcript_preview = serializers.SerializerMethodField()
    questions = serializers.SerializerMethodField()
    question_count = serializers.SerializerMethodField()

    class Meta:
        model = TrainingVideo
        fields = (
            'id',
            'file',
            'file_url',
            'original_name',
            'transcript',
            'transcript_preview',
            'questions',
            'question_count',
            'is_active',
            'ready',
            'uploaded_by',
            'uploaded_by_email',
            'created_at',
        )
        read_only_fields = (
            'id',
            'file_url',
            'transcript',
            'transcript_preview',
            'questions',
            'question_count',
            'is_active',
            'ready',
            'uploaded_by',
            'uploaded_by_email',
            'created_at',
        )
        extra_kwargs = {'file': {'write_only': True}}

    def get_file_url(self, obj):
        if not obj.file:
            return None
        request = self.context.get('request')
        url = obj.file.url
        if request:
            return request.build_absolute_uri(url)
        return url

    def get_ready(self, obj):
        # Ready when video exists and HO has authored assessment questions.
        return bool(obj.file and obj.has_questions)

    def get_transcript_preview(self, obj):
        text = (obj.transcript or '').strip()
        return text[:280] if text else ''

    def get_questions(self, obj):
        return obj.normalized_questions()

    def get_question_count(self, obj):
        return len(obj.normalized_questions())


class AmbassadorSerializer(serializers.ModelSerializer):
    training_url = serializers.SerializerMethodField()
    created_by_email = serializers.EmailField(source='created_by.email', read_only=True)
    store_name = serializers.SerializerMethodField()
    store_city = serializers.SerializerMethodField()

    class Meta:
        model = Ambassador
        fields = (
            'id',
            'name',
            'ba_code',
            'email',
            'city',
            'phone',
            'status',
            'invite_token',
            'is_active',
            'is_backup',
            'is_demo',
            'training_url',
            'overall_score',
            'report_json',
            'certified_at',
            'store',
            'store_name',
            'store_city',
            'deployed_at',
            'created_by',
            'created_by_email',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'ba_code',
            'invite_token',
            'training_url',
            'overall_score',
            'report_json',
            'certified_at',
            'store',
            'store_name',
            'store_city',
            'deployed_at',
            'created_by',
            'created_by_email',
            'created_at',
            'updated_at',
        )

    def get_training_url(self, obj):
        return obj.training_url

    def get_store_name(self, obj):
        return obj.store.name if obj.store_id else None

    def get_store_city(self, obj):
        return obj.store.city if obj.store_id else None


class PlatformSettingsSerializer(serializers.ModelSerializer):
    updated_by_email = serializers.EmailField(source='updated_by.email', read_only=True)

    class Meta:
        model = PlatformSettings
        fields = (
            'certification_threshold',
            'a_plus_threshold',
            'updated_at',
            'updated_by_email',
        )
        read_only_fields = ('updated_at', 'updated_by_email')

    def validate_certification_threshold(self, value):
        if value < 1 or value > 100:
            raise serializers.ValidationError('Must be between 1 and 100.')
        return value

    def validate_a_plus_threshold(self, value):
        if value < 1 or value > 100:
            raise serializers.ValidationError('Must be between 1 and 100.')
        return value

    def validate(self, attrs):
        cert = attrs.get(
            'certification_threshold',
            getattr(self.instance, 'certification_threshold', 75),
        )
        a_plus = attrs.get(
            'a_plus_threshold',
            getattr(self.instance, 'a_plus_threshold', 90),
        )
        if a_plus < cert:
            raise serializers.ValidationError(
                {'a_plus_threshold': 'A+ threshold must be greater than or equal to pass threshold.'}
            )
        return attrs


class AmbassadorCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ambassador
        fields = ('name', 'email', 'city', 'phone', 'is_backup', 'is_demo')

    def validate(self, attrs):
        if attrs.get('is_demo') and attrs.get('is_backup'):
            raise serializers.ValidationError({'is_backup': 'A demo account cannot be a backup BA.'})
        return attrs

    def validate_name(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Name is required.')
        return value


class AssessmentQuestionSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source='question_id')
    type = serializers.CharField(source='question_type')
    question = serializers.CharField(source='title')

    class Meta:
        model = AssessmentQuestion
        fields = ('id', 'type', 'question', 'description')


class AssessmentAnswerSerializer(serializers.ModelSerializer):
    question_id = serializers.CharField(source='question.question_id', read_only=True)

    class Meta:
        model = AssessmentAnswer
        fields = (
            'question_id',
            'question_title',
            'transcript',
            'communication_quality',
            'speaking_speed_wpm',
            'filler_rate',
            'nervousness_pct',
            'dominant_mood',
            'affect_breakdown',
            'speech_metrics',
            'linguistic_metrics',
            'question_relevance',
            'video_relevance',
            'analyzed_at',
        )


class ShiftAssignmentSerializer(serializers.ModelSerializer):
    """Frontend ShiftSlot shape (camelCase field aliases)."""

    id = serializers.SerializerMethodField()
    day = serializers.CharField(source='day_key', read_only=True)
    date = serializers.SerializerMethodField()
    dateIso = serializers.SerializerMethodField()
    storeId = serializers.IntegerField(source='store_id', read_only=True)
    storeName = serializers.CharField(source='store.name', read_only=True)
    city = serializers.CharField(source='store.city', read_only=True)
    shift = serializers.CharField(source='shift_label', required=False)
    startTime = serializers.TimeField(source='start_time', format='%H:%M', required=False, allow_null=True)
    endTime = serializers.TimeField(source='end_time', format='%H:%M', required=False, allow_null=True)
    peakRecommended = serializers.BooleanField(source='peak_recommended', required=False)
    baId = serializers.SerializerMethodField()
    baName = serializers.SerializerMethodField()
    coveredByName = serializers.SerializerMethodField()
    coverageOfName = serializers.SerializerMethodField()
    reportOwnerName = serializers.SerializerMethodField()
    coverageAssignedByName = serializers.SerializerMethodField()
    coverageAssignedAt = serializers.DateTimeField(source='coverage_assigned_at', read_only=True)
    coverageCancelled = serializers.BooleanField(source='coverage_cancelled', read_only=True)
    checkedIn = serializers.SerializerMethodField()
    checkedOut = serializers.SerializerMethodField()
    checkedInAt = serializers.DateTimeField(source='checked_in_at', read_only=True)
    checkedOutAt = serializers.DateTimeField(source='checked_out_at', read_only=True)
    checkInLat = serializers.FloatField(source='check_in_lat', read_only=True)
    checkInLng = serializers.FloatField(source='check_in_lng', read_only=True)
    checkInAccuracyM = serializers.FloatField(source='check_in_accuracy_m', read_only=True)
    store_id = serializers.PrimaryKeyRelatedField(
        queryset=Store.objects.all(),
        source='store',
        write_only=True,
    )
    ambassador_id = serializers.PrimaryKeyRelatedField(
        queryset=Ambassador.objects.all(),
        source='ambassador',
        write_only=True,
        required=False,
        allow_null=True,
    )
    date_iso = serializers.DateField(source='date', write_only=True)

    class Meta:
        model = ShiftAssignment
        fields = (
            'id',
            'day',
            'date',
            'dateIso',
            'date_iso',
            'storeId',
            'storeName',
            'city',
            'shift',
            'startTime',
            'endTime',
            'peakRecommended',
            'baId',
            'baName',
            'coveredByName',
            'coverageOfName',
            'reportOwnerName',
            'coverageAssignedByName',
            'coverageAssignedAt',
            'coverageCancelled',
            'status',
            'checkedIn',
            'checkedOut',
            'checkedInAt',
            'checkedOutAt',
            'checkInLat',
            'checkInLng',
            'checkInAccuracyM',
            'store_id',
            'ambassador_id',
        )
        read_only_fields = ('status',)

    def get_id(self, obj):
        return str(obj.pk)

    def get_date(self, obj):
        return obj.date.strftime('%d %b')

    def get_dateIso(self, obj):
        return obj.date.isoformat()

    def get_baId(self, obj):
        return str(obj.ambassador_id) if obj.ambassador_id else None

    def get_baName(self, obj):
        return obj.ambassador.name if obj.ambassador_id else None

    def get_coveredByName(self, obj):
        return obj.covered_by.name if obj.covered_by_id else None

    def get_coverageOfName(self, obj):
        return obj.coverage_of.ambassador.name if obj.coverage_of_id and obj.coverage_of.ambassador_id else None

    def get_reportOwnerName(self, obj):
        return obj.report_owner.name if obj.report_owner_id else (obj.ambassador.name if obj.ambassador_id else None)

    def get_coverageAssignedByName(self, obj):
        if obj.coverage_assigned_by_id:
            return obj.coverage_assigned_by.get_full_name() or obj.coverage_assigned_by.get_username()
        return None

    def get_checkedIn(self, obj):
        return bool(obj.checked_in_at)

    def get_checkedOut(self, obj):
        return bool(obj.checked_out_at)

    def validate(self, attrs):
        start = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        # Overnight shifts allowed: end before/equal start means the shift ends next morning.
        if ('start_time' in attrs or 'end_time' in attrs) and start and end:
            attrs['shift_label'] = label_from_times(start.strftime('%H:%M'), end.strftime('%H:%M'))
        if self.instance is None and not attrs.get('shift_label'):
            raise serializers.ValidationError({'shift': 'Give a start and end time.'})
        return attrs

    def _apply_peak_and_day(self, validated):
        store = validated.get('store') or getattr(self.instance, 'store', None)
        shift_label = validated.get('shift_label') or getattr(self.instance, 'shift_label', '')
        date_val = validated.get('date') or getattr(self.instance, 'date', None)
        if date_val is not None:
            validated['day_key'] = day_key_for(date_val)
        if 'peak_recommended' not in validated and store is not None:
            validated['peak_recommended'] = peak_matches(shift_label, store.peak_hours or '')
        return validated

    def create(self, validated_data):
        validated_data = self._apply_peak_and_day(validated_data)
        ambassador = validated_data.get('ambassador')
        date_val = validated_data['date']
        shift_label = validated_data['shift_label']
        if ambassador is None:
            validated_data['status'] = ShiftAssignment.Status.OPEN
        else:
            conflict = ShiftAssignment.objects.filter(
                ambassador=ambassador,
                date=date_val,
                shift_label=shift_label,
            ).exists()
            validated_data['status'] = (
                ShiftAssignment.Status.CONFLICT
                if conflict
                else ShiftAssignment.Status.SCHEDULED
            )
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data = self._apply_peak_and_day(validated_data)
        ambassador = validated_data.get('ambassador', instance.ambassador)
        date_val = validated_data.get('date', instance.date)
        shift_label = validated_data.get('shift_label', instance.shift_label)
        if ambassador is None:
            validated_data['status'] = ShiftAssignment.Status.OPEN
        else:
            conflict = (
                ShiftAssignment.objects.filter(
                    ambassador=ambassador,
                    date=date_val,
                    shift_label=shift_label,
                )
                .exclude(pk=instance.pk)
                .exists()
            )
            validated_data['status'] = (
                ShiftAssignment.Status.CONFLICT
                if conflict
                else ShiftAssignment.Status.SCHEDULED
            )
        return super().update(instance, validated_data)


class MonthlyShiftSerializer(serializers.ModelSerializer):
    """A BA at a store at fixed hours for a whole month (no dates)."""

    id = serializers.SerializerMethodField()
    monthLabel = serializers.SerializerMethodField()
    storeId = serializers.IntegerField(source='store_id', read_only=True)
    storeName = serializers.CharField(source='store.name', read_only=True)
    storeCode = serializers.CharField(source='store.store_code', read_only=True)
    city = serializers.CharField(source='store.city', read_only=True)
    shift = serializers.CharField(source='shift_label', read_only=True)
    startTime = serializers.TimeField(source='start_time', format='%H:%M')
    endTime = serializers.TimeField(source='end_time', format='%H:%M')
    peakRecommended = serializers.BooleanField(source='peak_recommended', read_only=True)
    baId = serializers.SerializerMethodField()
    baName = serializers.SerializerMethodField()
    baCode = serializers.SerializerMethodField()
    backupCoverage = serializers.SerializerMethodField()
    store_id = serializers.PrimaryKeyRelatedField(queryset=Store.objects.all(), source='store', write_only=True)
    ambassador_id = serializers.PrimaryKeyRelatedField(
        queryset=Ambassador.objects.all(),
        source='ambassador',
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = MonthlyShift
        fields = (
            'id',
            'month',
            'monthLabel',
            'storeId',
            'storeName',
            'storeCode',
            'city',
            'shift',
            'startTime',
            'endTime',
            'peakRecommended',
            'baId',
            'baName',
            'baCode',
            'backupCoverage',
            'status',
            'store_id',
            'ambassador_id',
        )
        read_only_fields = ('status',)

    def get_id(self, obj):
        return str(obj.pk)

    def get_monthLabel(self, obj):
        parsed = parse_month(obj.month)
        return date(parsed[0], parsed[1], 1).strftime('%B %Y') if parsed else obj.month

    def get_baId(self, obj):
        return str(obj.ambassador_id) if obj.ambassador_id else None

    def get_baName(self, obj):
        return obj.ambassador.name if obj.ambassador_id else None

    def get_baCode(self, obj):
        return obj.ambassador.ba_code if obj.ambassador_id else None

    def validate_ambassador_id(self, value):
        if value and value.is_demo:
            raise serializers.ValidationError('Demo accounts cannot be assigned to monthly shifts.')
        return value

    def get_backupCoverage(self, obj):
        if not obj.ambassador_id:
            return None
        month_start = date.fromisoformat(f'{obj.month}-01')
        month_end = date(month_start.year, month_start.month, 1)
        if month_start.month == 12:
            month_end = date(month_start.year + 1, 1, 1)
        else:
            month_end = date(month_start.year, month_start.month + 1, 1)
        coverage = (
            BackupCoverage.objects.filter(original_ba_id=obj.ambassador_id, store_id=obj.store_id, starts_on__lt=month_end)
            .filter(Q(ends_on__isnull=True) | Q(ends_on__gte=month_start))
            .select_related('backup_ba')
            .order_by('-starts_on', '-id')
            .first()
        )
        if not coverage:
            return None
        return {
            'id': coverage.id,
            'baId': coverage.backup_ba_id,
            'baName': coverage.backup_ba.name if coverage.backup_ba_id else 'Backup BA',
            'startsOn': coverage.starts_on.isoformat(),
            'endsOn': coverage.ends_on.isoformat() if coverage.ends_on else None,
            'endedAt': coverage.ended_at.isoformat() if coverage.ended_at else None,
        }

    def validate_month(self, value):
        parsed = parse_month(value)
        if not parsed:
            raise serializers.ValidationError('Month must be YYYY-MM.')
        return '%04d-%02d' % parsed

    def validate(self, attrs):
        start = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        # Overnight shifts allowed: end before/equal start means the shift ends next morning.
        if ('start_time' in attrs or 'end_time' in attrs) and start and end:
            attrs['shift_label'] = label_from_times(start.strftime('%H:%M'), end.strftime('%H:%M'))
        ambassador = attrs.get('ambassador', getattr(self.instance, 'ambassador', None))
        month = attrs.get('month', getattr(self.instance, 'month', None))
        if ambassador and month:
            parsed = parse_month(month)
            if parsed:
                first_day = date(parsed[0], parsed[1], 1)
                next_month = date(parsed[0] + (1 if parsed[1] == 12 else 0), 1 if parsed[1] == 12 else parsed[1] + 1, 1)
                has_backup_coverage = BackupCoverage.objects.filter(
                    backup_ba=ambassador, starts_on__lt=next_month
                ).filter(Q(ends_on__isnull=True) | Q(ends_on__gte=first_day)).exists()
                if has_backup_coverage:
                    raise serializers.ValidationError(
                        {'ambassador_id': 'This BA has an active backup assignment during that month. End coverage before scheduling them elsewhere.'}
                    )
        return attrs

    def _finish(self, shift):
        shift.shift_label = label_from_times(shift.start_time.strftime('%H:%M'), shift.end_time.strftime('%H:%M'))
        shift.peak_recommended = peak_matches(shift.shift_label, shift.store.peak_hours or '')
        shift.status = monthly_status(shift)
        shift.save()
        return shift

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        return self._finish(MonthlyShift(**validated_data))

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        return self._finish(instance)


class BackupCoverageSerializer(serializers.ModelSerializer):
    monthlyShiftId = serializers.IntegerField(source='monthly_shift_id', read_only=True)
    originalBaId = serializers.IntegerField(source='original_ba_id', read_only=True)
    originalBaName = serializers.CharField(source='original_ba.name', read_only=True)
    backupBaId = serializers.IntegerField(source='backup_ba_id', read_only=True)
    backupBaName = serializers.CharField(source='backup_ba.name', read_only=True)
    storeId = serializers.IntegerField(source='store_id', read_only=True)
    storeName = serializers.CharField(source='store.name', read_only=True)
    startsOn = serializers.DateField(source='starts_on', read_only=True)
    endsOn = serializers.DateField(source='ends_on', read_only=True, allow_null=True)

    class Meta:
        model = BackupCoverage
        fields = (
            'id', 'monthlyShiftId', 'originalBaId', 'originalBaName', 'backupBaId', 'backupBaName',
            'storeId', 'storeName', 'startsOn', 'endsOn', 'assigned_at', 'ended_at',
        )
