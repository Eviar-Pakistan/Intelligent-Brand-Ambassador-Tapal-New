import io
import secrets

_BA_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

import qrcode
from django.conf import settings
from django.core.files.base import ContentFile
from django.db import models


class Store(models.Model):
    class Footfall(models.TextChoices):
        HIGH = 'High', 'High'
        MEDIUM = 'Medium', 'Medium'
        LOW = 'Low', 'Low'

    class Status(models.TextChoices):
        LIVE = 'LIVE', 'Live'
        PARTIAL = 'PARTIAL', 'Partial'
        PENDING = 'Pending', 'Pending'
        INACTIVE = 'INACTIVE', 'Inactive'

    name = models.CharField(max_length=200)
    store_code = models.CharField(max_length=32, unique=True, blank=True)
    city = models.CharField(max_length=100)
    address = models.TextField()
    footfall = models.CharField(
        max_length=20,
        choices=Footfall.choices,
        default=Footfall.MEDIUM,
    )
    peak_hours = models.CharField(max_length=200, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    contact_phone = models.CharField(max_length=30, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    coverage = models.PositiveSmallIntegerField(default=0)
    bas = models.PositiveSmallIntegerField(default=0)
    today_footfall = models.PositiveIntegerField(default=0)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    qr_slug = models.SlugField(max_length=64, unique=True, blank=True)
    qr_image = models.ImageField(upload_to='store_qr/', blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='stores',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.city})'

    @property
    def shopper_url(self) -> str:
        base = getattr(settings, 'SHOPPER_QR_BASE_URL', 'http://localhost:8000').rstrip('/')
        return f'{base}/shopper/{self.qr_slug}'

    def ensure_store_code(self) -> None:
        code = (self.store_code or '').strip().upper()
        if code:
            self.store_code = code
            return
        for _ in range(20):
            generated = 'ST-' + ''.join(secrets.choice(_BA_CODE_ALPHABET) for _ in range(6))
            if not Store.objects.filter(store_code=generated).exists():
                self.store_code = generated
                return
        self.store_code = 'ST-' + secrets.token_hex(4).upper()

    def ensure_qr_slug(self) -> None:
        if self.qr_slug:
            return
        token = secrets.token_urlsafe(8).replace('_', '').replace('-', '').lower()[:12]
        if self.pk:
            self.qr_slug = f's{self.pk}-{token}'
        else:
            self.qr_slug = f'stmp-{token}'

    def generate_qr_image(self, force: bool = False) -> None:
        if not self.qr_slug:
            self.ensure_qr_slug()
        if self.qr_image and not force:
            return

        img = qrcode.make(self.shopper_url)
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        filename = f'store-{self.pk or "new"}-{self.qr_slug}.png'
        if self.qr_image:
            self.qr_image.delete(save=False)
        self.qr_image.save(filename, ContentFile(buffer.getvalue()), save=False)

    def ensure_coordinates(self, force: bool = False) -> bool:
        """Assign lat/lng from city centroid (+ stable offset) when missing."""
        if not force and self.latitude is not None and self.longitude is not None:
            return False
        from .geo import coordinates_for_store

        lat, lng = coordinates_for_store(self.city, self.pk or 0, self.address)
        self.latitude = lat
        self.longitude = lng
        return True

    def save(self, *args, **kwargs):
        creating = self.pk is None
        self.ensure_store_code()
        self.ensure_qr_slug()
        # Only auto-fill coordinates when the user did not provide them.
        if self.latitude is None or self.longitude is None:
            self.ensure_coordinates(force=True)

        super().save(*args, **kwargs)

        update_fields: list[str] = []
        if creating and self.qr_slug.startswith('stmp-'):
            token = secrets.token_urlsafe(8).replace('_', '').replace('-', '').lower()[:12]
            self.qr_slug = f's{self.pk}-{token}'
            self.generate_qr_image(force=True)
            update_fields.extend(['qr_slug', 'qr_image'])

        # If coords were still empty before pk existed, fill once (never overwrite manual values).
        if self.latitude is None or self.longitude is None:
            self.ensure_coordinates(force=True)
            update_fields.extend(['latitude', 'longitude'])

        if not self.qr_image and 'qr_image' not in update_fields:
            self.generate_qr_image(force=True)
            update_fields.append('qr_image')

        if update_fields:
            update_fields.append('updated_at')
            super().save(update_fields=list(dict.fromkeys(update_fields)))


class StoreReward(models.Model):
    """Shopper spin / claim reward configured by Admin for a specific store."""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='rewards')
    label = models.CharField(max_length=120, help_text='Wheel / prize label')
    win_amount = models.CharField(max_length=80, help_text='e.g. Rs. 100 OFF')
    win_detail = models.CharField(max_length=200, blank=True)
    promo_code = models.CharField(max_length=40, blank=True)
    is_active = models.BooleanField(default=True)
    is_featured = models.BooleanField(
        default=False,
        help_text='Featured reward is shown when the shopper wins / claims',
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sort_order', 'id']

    def __str__(self):
        return f'{self.label} @ store {self.store_id}'


class SurveyQuestion(models.Model):
    """Shopper survey questions published by Head Office for one store."""

    store = models.ForeignKey(
        Store,
        on_delete=models.CASCADE,
        related_name='survey_questions',
        null=True,
        blank=True,
        help_text='Leave empty only for legacy fallback questions.',
    )
    order = models.PositiveSmallIntegerField()
    text = models.CharField(max_length=300)
    options = models.JSONField(default=list, help_text='List of answer choice strings')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order']
        constraints = [
            models.UniqueConstraint(fields=['store', 'order'], name='unique_survey_question_order_per_store'),
        ]

    def __str__(self):
        return f'Q{self.order}: {self.text}'


class Consumer(models.Model):
    """Shopper / consumer captured at a store during the in-store journey."""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='consumers')
    name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    consent = models.BooleanField(default=False)
    answers = models.JSONField(
        default=dict,
        help_text='Map of question id (str) -> selected answer text',
    )
    feedback_rating = models.PositiveSmallIntegerField(null=True, blank=True)
    feedback_comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        label = self.name or self.phone or f'Consumer #{self.pk}'
        return f'{label} @ {self.store_id}'


class AmbassadorComplaint(models.Model):
    """A store issue submitted by a Brand Ambassador for Head Office review."""

    class Status(models.TextChoices):
        OPEN = 'Open', 'Open'
        IN_REVIEW = 'In Review', 'In Review'
        RESOLVED = 'Resolved', 'Resolved'

    ambassador = models.ForeignKey('Ambassador', on_delete=models.CASCADE, related_name='complaints')
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='ambassador_complaints')
    complaint = models.TextField(max_length=2000)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Complaint #{self.pk} · {self.store.name}'


class TrainingVideo(models.Model):
    """HO-uploaded BA training video. Only one is_active at a time (latest)."""

    file = models.FileField(upload_to='training_videos/')
    original_name = models.CharField(max_length=255, blank=True)
    transcript = models.TextField(blank=True)
    questions_json = models.JSONField(
        default=list,
        blank=True,
        help_text='HO-authored assessment questions: [{id, type, question, description}, …]',
    )
    is_active = models.BooleanField(default=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='training_videos',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        flag = 'active' if self.is_active else 'inactive'
        return f'{self.original_name or self.file.name} ({flag})'

    @property
    def has_questions(self) -> bool:
        return bool(self.normalized_questions())

    def normalized_questions(self) -> list[dict]:
        """Return cleaned question list for assessment sessions."""
        raw = self.questions_json or []
        if not isinstance(raw, list):
            return []
        out = []
        for i, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            title = str(item.get('question') or item.get('title') or '').strip()
            if not title:
                continue
            qid = str(item.get('id') or f'q{i + 1}').strip() or f'q{i + 1}'
            out.append(
                {
                    'id': qid,
                    'type': str(item.get('type') or 'verbal').strip() or 'verbal',
                    'question': title,
                    'description': str(item.get('description') or '').strip(),
                }
            )
        return out


class Ambassador(models.Model):
    class Status(models.TextChoices):
        PENDING = 'Pending', 'Pending'
        TRAINING = 'Training', 'Training'
        ASSESSED = 'Assessed', 'Assessed'
        CERTIFIED = 'Certified', 'Certified'
        REJECTED = 'Rejected', 'Rejected'
        DEPLOYED = 'Deployed', 'Deployed'

    name = models.CharField(max_length=120)
    ba_code = models.CharField(max_length=16, unique=True, blank=True)
    email = models.EmailField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    invite_token = models.CharField(max_length=64, unique=True, blank=True)
    overall_score = models.FloatField(null=True, blank=True)
    report_json = models.JSONField(default=dict, blank=True)
    certified_at = models.DateTimeField(null=True, blank=True)
    store = models.ForeignKey(
        'Store',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ambassadors',
    )
    deployed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_ambassadors',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.status})'

    @property
    def training_url(self) -> str:
        base = getattr(settings, 'FRONTEND_BASE_URL', 'http://localhost:5173').rstrip('/')
        return f'{base}/ba/training?token={self.invite_token}'

    def ensure_invite_token(self) -> None:
        if self.invite_token:
            return
        self.invite_token = secrets.token_urlsafe(24)

    def ensure_ba_code(self) -> None:
        if self.ba_code:
            return
        for _ in range(12):
            code = 'BA-' + ''.join(secrets.choice(_BA_CODE_ALPHABET) for _ in range(6))
            if not Ambassador.objects.filter(ba_code=code).exists():
                self.ba_code = code
                return
        self.ba_code = 'BA-' + secrets.token_hex(4).upper()

    def save(self, *args, **kwargs):
        self.ensure_ba_code()
        self.ensure_invite_token()
        super().save(*args, **kwargs)


class AmbassadorMonthTarget(models.Model):
    """Monthly product target for the ambassador assigned to a store."""

    ambassador = models.ForeignKey(
        Ambassador,
        on_delete=models.CASCADE,
        related_name='month_targets',
    )
    store = models.ForeignKey(
        Store,
        on_delete=models.CASCADE,
        related_name='month_targets',
    )
    month = models.CharField(max_length=7, help_text='YYYY-MM')
    target_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sales_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    lines = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['store__name', 'ambassador__name']
        constraints = [
            models.UniqueConstraint(
                fields=['ambassador', 'month'],
                name='unique_ambassador_month_target',
            ),
        ]

    def __str__(self):
        return f'{self.ambassador} · {self.month}'


class PlatformSettings(models.Model):
    """Singleton row for platform-wide BA / campaign settings."""

    certification_threshold = models.PositiveSmallIntegerField(
        default=75,
        help_text='Minimum communication_quality score (0–100) required to certify a BA.',
    )
    a_plus_threshold = models.PositiveSmallIntegerField(
        default=90,
        help_text='Optional higher band for A+ labelling (display / future use).',
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='platform_settings_updates',
    )

    class Meta:
        verbose_name = 'Platform settings'
        verbose_name_plural = 'Platform settings'

    def __str__(self):
        return f'Certification pass ≥ {self.certification_threshold}'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls) -> 'PlatformSettings':
        obj, _ = cls.objects.get_or_create(
            pk=1,
            defaults={
                'certification_threshold': int(
                    getattr(settings, 'BA_CERTIFICATION_THRESHOLD', 75) or 75
                ),
                'a_plus_threshold': 90,
            },
        )
        return obj


class AssessmentSession(models.Model):
    class Status(models.TextChoices):
        IN_PROGRESS = 'in_progress', 'In progress'
        COMPLETED = 'completed', 'Completed'

    id = models.UUIDField(primary_key=True, editable=False)
    ambassador = models.ForeignKey(
        Ambassador,
        on_delete=models.CASCADE,
        related_name='sessions',
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.IN_PROGRESS,
    )
    report_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.id:
            import uuid

            self.id = uuid.uuid4()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'Session {self.id} · {self.ambassador_id}'


class AssessmentQuestion(models.Model):
    session = models.ForeignKey(
        AssessmentSession,
        on_delete=models.CASCADE,
        related_name='questions',
    )
    question_id = models.CharField(max_length=40)
    question_type = models.CharField(max_length=20, default='verbal')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'id']
        unique_together = [('session', 'question_id')]

    def __str__(self):
        return f'{self.question_id}: {self.title}'


class AssessmentAnswer(models.Model):
    session = models.ForeignKey(
        AssessmentSession,
        on_delete=models.CASCADE,
        related_name='answers',
    )
    question = models.ForeignKey(
        AssessmentQuestion,
        on_delete=models.CASCADE,
        related_name='answers',
    )
    question_title = models.CharField(max_length=200, blank=True)
    audio_file = models.FileField(upload_to='assessment_audio/', blank=True)
    transcript = models.TextField(blank=True)
    communication_quality = models.FloatField(null=True, blank=True)
    speaking_speed_wpm = models.FloatField(null=True, blank=True)
    filler_rate = models.FloatField(null=True, blank=True)
    nervousness_pct = models.FloatField(null=True, blank=True)
    dominant_mood = models.CharField(max_length=40, blank=True)
    affect_breakdown = models.JSONField(default=dict, blank=True)
    speech_metrics = models.JSONField(default=dict, blank=True)
    linguistic_metrics = models.JSONField(default=dict, blank=True)
    question_relevance = models.JSONField(default=dict, blank=True)
    video_relevance = models.JSONField(default=dict, blank=True)
    analyzed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('session', 'question')]

    def __str__(self):
        return f'Answer {self.question.question_id} @ {self.session_id}'


class MonthlyShift(models.Model):
    """HO schedule: a BA works at a store at the same hours for a whole month. No dates."""

    class Status(models.TextChoices):
        OPEN = 'Open', 'Open'
        SCHEDULED = 'Scheduled', 'Scheduled'
        CONFLICT = 'Conflict', 'Conflict'

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='monthly_shifts')
    ambassador = models.ForeignKey(
        Ambassador,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='monthly_shifts',
    )
    month = models.CharField(max_length=7, db_index=True, help_text='YYYY-MM')
    start_time = models.TimeField()
    end_time = models.TimeField()
    shift_label = models.CharField(max_length=64)
    peak_recommended = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_monthly_shifts',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-month', 'store__name', 'start_time', 'id']

    def __str__(self):
        who = self.ambassador.name if self.ambassador_id else 'Open'
        return f'{self.month} {self.shift_label} · {self.store_id} · {who}'


class ShiftAssignment(models.Model):
    """One day of a monthly shift: the attendance record BAs check in and out against."""

    class Status(models.TextChoices):
        OPEN = 'Open', 'Open'
        SCHEDULED = 'Scheduled', 'Scheduled'
        CONFLICT = 'Conflict', 'Conflict'

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='shifts')
    monthly_shift = models.ForeignKey(
        MonthlyShift,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='days',
    )
    ambassador = models.ForeignKey(
        Ambassador,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='shifts',
    )
    date = models.DateField(help_text='Calendar date of the shift')
    day_key = models.CharField(max_length=3, help_text='Mon…Sun for UI week board')
    shift_label = models.CharField(max_length=64)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    peak_recommended = models.BooleanField(default=False)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    check_in_lat = models.FloatField(null=True, blank=True)
    check_in_lng = models.FloatField(null=True, blank=True)
    check_in_accuracy_m = models.FloatField(null=True, blank=True)
    report_submitted_at = models.DateTimeField(
        null=True, blank=True, help_text='When the BA submitted the checkout report (check-out counts only after this)'
    )
    checkout_report = models.JSONField(default=dict, blank=True, help_text='Stock, sales and competitor data')
    early_checkout_reason = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_shifts',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['date', 'shift_label', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['monthly_shift', 'date'],
                condition=models.Q(monthly_shift__isnull=False),
                name='one_day_per_monthly_shift',
            )
        ]

    def __str__(self):
        who = self.ambassador.name if self.ambassador_id else 'Open'
        return f'{self.date} {self.shift_label} · {self.store_id} · {who}'

    @property
    def is_checked_in(self) -> bool:
        return bool(self.checked_in_at) and not self.checked_out_at

    @property
    def is_checked_out(self) -> bool:
        return bool(self.checked_out_at)

    def sync_status(self) -> None:
        if self.ambassador_id:
            self.status = self.Status.SCHEDULED
        elif self.status != self.Status.CONFLICT:
            self.status = self.Status.OPEN
