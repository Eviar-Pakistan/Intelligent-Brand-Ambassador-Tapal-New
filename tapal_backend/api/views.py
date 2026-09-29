from datetime import date, datetime

from django.conf import settings
from django.utils import timezone
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, redirect
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .city_scope import scope_for, viewer_scope
from .manager_ops import build_manager_overview
from .intelligence import (
    build_ba_leaderboard,
    build_campaign_metrics,
    build_intelligence_overview,
    build_store_map_pins,
)
from .models import (
    Ambassador,
    AmbassadorComplaint,
    AmbassadorMonthTarget,
    Consumer,
    MonthlyShift,
    PlatformSettings,
    ShiftAssignment,
    Store,
    StoreReward,
    SurveyQuestion,
)
from .serializers import (
    ConsumerCreateSerializer,
    ConsumerSerializer,
    AmbassadorComplaintSerializer,
    PlatformSettingsSerializer,
    MonthlyShiftSerializer,
    ShiftAssignmentSerializer,
    StoreRewardSerializer,
    StoreSerializer,
    SurveyQuestionSerializer,
)
from .shifts import (
    build_attendance,
    create_month_shifts,
    drop_pending_daily_rows,
    parse_month,
    sync_daily_rows,
)


class StoreViewSet(viewsets.ModelViewSet):
    """
    list / retrieve / create / update / partial_update / destroy stores.
    """

    serializer_class = StoreSerializer
    permission_classes = [IsAuthenticated]
    queryset = Store.objects.select_related('created_by').all()

    def get_queryset(self):
        return (
            scope_for(self.request.user)
            .stores(Store.objects.select_related('created_by'), 'id')
            .annotate(
                shopper_count_ann=Count('consumers', distinct=True),
                assigned_bas_ann=Count(
                    'ambassadors',
                    filter=Q(
                        ambassadors__status__in=(
                            Ambassador.Status.CERTIFIED,
                            Ambassador.Status.DEPLOYED,
                        )
                    ),
                    distinct=True,
                ),
            )
            .all()
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def perform_create(self, serializer):
        # A city Head Office user's new stores are in their city.
        city = scope_for(self.request.user).city
        serializer.save(created_by=self.request.user, **({'city': city} if city else {}))

    def perform_update(self, serializer):
        city = scope_for(self.request.user).city
        serializer.save(**({'city': city} if city else {}))

    @action(detail=True, methods=['post'], url_path='footfall')
    def footfall(self, request, pk=None):
        """POST {count}: today's footfall for this store."""
        from .store_live import record_footfall

        store = self.get_object()
        try:
            count = int(request.data.get('count'))
            if count < 0:
                raise ValueError
        except (TypeError, ValueError):
            return Response({'detail': 'Enter today\'s footfall as a whole number.'}, status=status.HTTP_400_BAD_REQUEST)
        record_footfall(store, count, entered_by=request.user.email)
        return Response(StoreSerializer(store, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='regenerate-qr')
    def regenerate_qr(self, request, pk=None):
        store = self.get_object()
        store.generate_qr_image(force=True)
        store.save()
        refreshed = self.get_queryset().filter(pk=store.pk).first() or store
        return Response(StoreSerializer(refreshed, context=self.get_serializer_context()).data)


class SurveyQuestionViewSet(viewsets.ModelViewSet):
    """Head Office CRUD for store-targeted shopper survey questions."""

    serializer_class = SurveyQuestionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        scope = scope_for(self.request.user)
        questions = SurveyQuestion.objects.select_related('store').all()
        if not scope.is_all:
            mine = Q(store_id__in=scope.store_ids)
            questions = questions.filter(mine if self.action not in ('list', 'retrieve') else mine | Q(store__isnull=True))
        store_id = self.request.query_params.get('store')
        if store_id:
            questions = questions.filter(store_id=store_id)
        return questions.order_by('order', 'id')


class AmbassadorComplaintViewSet(viewsets.ModelViewSet):
    """Head Office complaint inbox and status updates."""

    serializer_class = AmbassadorComplaintSerializer
    permission_classes = [IsAuthenticated]
    queryset = AmbassadorComplaint.objects.select_related('ambassador', 'store').all()
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        return scope_for(self.request.user).stores(super().get_queryset())


class MonthlyShiftViewSet(viewsets.ModelViewSet):
    """
    Monthly BA shifts: one row = BA + store + hours for a whole month.
    list ?month=YYYY-MM · ?ambassador=<id> · ?from_month=YYYY-MM
    """

    serializer_class = MonthlyShiftSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = scope_for(self.request.user).stores(MonthlyShift.objects.select_related('store', 'ambassador').all())
        if getattr(self, 'action', None) != 'list':
            return qs
        params = self.request.query_params
        month = parse_month(params.get('month'))
        if month:
            qs = qs.filter(month='%04d-%02d' % month)
        from_month = parse_month(params.get('from_month'))
        if from_month:
            qs = qs.filter(month__gte='%04d-%02d' % from_month)
        if params.get('ambassador'):
            qs = qs.filter(ambassador_id=params['ambassador'])
        if params.get('store'):
            qs = qs.filter(store_id=params['store'])
        return qs

    def list(self, request, *args, **kwargs):
        data = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True).data
        month = parse_month(request.query_params.get('month'))
        if month:
            first = date(month[0], month[1], 1)
            return Response({'month': f'{first:%Y-%m}', 'month_label': f'{first:%B %Y}', 'results': data})
        return Response({'results': data})

    def _check_store(self, serializer):
        from rest_framework.exceptions import PermissionDenied

        store = serializer.validated_data.get('store')
        if store is not None and not scope_for(self.request.user).allows_store(store.id):
            raise PermissionDenied('You can only schedule shifts at stores in your city.')

    def perform_create(self, serializer):
        self._check_store(serializer)
        serializer.save()

    def perform_update(self, serializer):
        self._check_store(serializer)
        sync_daily_rows(serializer.save())

    def perform_destroy(self, instance):
        drop_pending_daily_rows(instance)
        instance.delete()

    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk(self, request):
        """POST {rows: [{ba_code, store_code, start_time, end_time, month}]}. One row = one monthly shift."""
        rows = request.data.get('rows')
        if not isinstance(rows, list) or not rows:
            return Response({'detail': 'Send at least one shift row.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(rows) > 2000:
            return Response({'detail': 'Upload at most 2000 rows at a time.'}, status=status.HTTP_400_BAD_REQUEST)
        result = create_month_shifts(
            [r for r in rows if isinstance(r, dict)], request.user, scope=scope_for(request.user)
        )
        code = status.HTTP_201_CREATED if result['rows_saved'] else status.HTTP_400_BAD_REQUEST
        return Response(result, status=code)


class ShiftDayViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Attendance: the daily check-in/out records made from monthly shifts.
    list ?ambassador=<id> · ?store=<id> · ?date_from=YYYY-MM-DD · ?date_to=YYYY-MM-DD
    """

    serializer_class = ShiftAssignmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = scope_for(self.request.user).stores(
            ShiftAssignment.objects.select_related('store', 'ambassador').order_by('-date', 'shift_label', 'id')
        )
        params = self.request.query_params
        if params.get('ambassador'):
            qs = qs.filter(ambassador_id=params['ambassador'])
        if params.get('store'):
            qs = qs.filter(store_id=params['store'])
        for key, lookup in (('date_from', 'date__gte'), ('date_to', 'date__lte')):
            try:
                qs = qs.filter(**{lookup: datetime.strptime(params[key], '%Y-%m-%d').date()})
            except (KeyError, ValueError):
                pass
        return qs


class ConsumerViewSet(viewsets.ReadOnlyModelViewSet):
    """Authenticated list/retrieve of consumers (HO / Admin / Manager)."""

    serializer_class = ConsumerSerializer
    permission_classes = [IsAuthenticated]
    queryset = Consumer.objects.select_related('store').all()

    def get_queryset(self):
        qs = scope_for(self.request.user).stores(super().get_queryset())
        store_id = self.request.query_params.get('store')
        store_slug = self.request.query_params.get('store_slug')
        if store_id:
            qs = qs.filter(store_id=store_id)
        if store_slug:
            qs = qs.filter(store__qr_slug=store_slug)
        return qs


class StoreRewardViewSet(viewsets.ModelViewSet):
    """Authenticated CRUD for per-store shopper rewards (Admin)."""

    serializer_class = StoreRewardSerializer
    permission_classes = [IsAuthenticated]
    queryset = StoreReward.objects.select_related('store').all()

    def get_queryset(self):
        qs = scope_for(self.request.user).stores(super().get_queryset())
        store_id = self.request.query_params.get('store')
        if store_id:
            qs = qs.filter(store_id=store_id)
        return qs


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_attendance(request):
    """
    GET /api/attendance/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&ambassador=<id>&store=<id>
    One row per BA per shift day with Present / On shift / Not checked in / Absent. Defaults to today.
    """

    def parse(key):
        try:
            return datetime.strptime(request.query_params[key], '%Y-%m-%d').date()
        except (KeyError, ValueError):
            return None

    viewer = viewer_scope(request)  # Head Office, or a supervisor for their own stores
    if viewer is None:
        return Response({'detail': 'Sign in to continue.'}, status=status.HTTP_401_UNAUTHORIZED)
    today = timezone.localdate()
    date_to = parse('date_to') or today
    date_from = parse('date_from') or date_to
    return Response(
        build_attendance(
            date_from,
            date_to,
            ambassador_id=request.query_params.get('ambassador') or None,
            store_id=request.query_params.get('store') or None,
            scope=viewer[0],
        )
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def campaign_metrics(request):
    """Head Office Campaign Metrics page: KPIs, trend, map, insights, operations, BAs, stores."""
    return Response(build_campaign_metrics(scope_for(request.user)))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def intelligence_overview(request):
    """
    Head Office / Admin dashboard aggregates:
    shoppers, active stores, engagement/conversion rates,
    7-day trend, consumer insights, shopper intelligence.
    """
    return Response(build_intelligence_overview(scope_for(request.user)))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def intelligence_store_map(request):
    """Mapbox pins for Live Store Map on the Command Center."""
    return Response({'pins': build_store_map_pins(scope_for(request.user))})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def intelligence_leaderboard(request):
    """Ranked BA leaderboard with points, conversion, and week activity."""
    return Response(build_ba_leaderboard(scope_for(request.user)))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def manager_overview(request):
    """Store Manager dashboard: KPIs, live attendance, coverage stores."""
    return Response(build_manager_overview(scope_for(request.user)))


@api_view(['GET'])
@permission_classes([AllowAny])
def shopper_store_lookup(request, slug):
    """
    Public check: does this QR store slug exist?
    Used by the shopper frontend gate before allowing /shopper?store=…
    """
    store = Store.objects.filter(qr_slug=slug).only('id', 'name', 'city', 'qr_slug', 'status').first()
    if not store:
        return Response({'detail': 'Store not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(
        {
            'id': store.id,
            'name': store.name,
            'city': store.city,
            'qr_slug': store.qr_slug,
            'status': store.status,
        }
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def shopper_survey_questions(request):
    """Public active survey questions for the store QR slug."""
    slug = (request.query_params.get('store') or '').strip()
    store = Store.objects.filter(qr_slug=slug).first() if slug else None
    if slug and not store:
        return Response({'detail': 'Store not found.'}, status=status.HTTP_404_NOT_FOUND)
    questions = SurveyQuestion.objects.none()
    if store:
        questions = SurveyQuestion.objects.filter(is_active=True, store=store)
    # Preserve old global questions for unconfigured stores and non-store legacy callers.
    if not questions.exists():
        questions = SurveyQuestion.objects.filter(is_active=True, store__isnull=True)
    questions = questions.order_by('order', 'id')
    return Response(SurveyQuestionSerializer(questions, many=True).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def shopper_store_rewards(request, slug):
    """Public active rewards for a store QR slug (used by spin / claim)."""
    store = Store.objects.filter(qr_slug=slug).first()
    if not store:
        return Response({'detail': 'Store not found.'}, status=status.HTTP_404_NOT_FOUND)
    rewards = StoreReward.objects.filter(store=store, is_active=True).order_by('sort_order', 'id')
    return Response(StoreRewardSerializer(rewards, many=True).data)


@api_view(['POST'])
@permission_classes([AllowAny])
def shopper_create_consumer(request):
    """
    Public: save consumer survey answers for a store.
    Body: { store_slug, consent, answers: { "<question_id>": "option text" }, name?, phone? }
    """
    serializer = ConsumerCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    consumer = serializer.save()
    return Response(ConsumerSerializer(consumer).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([AllowAny])
def shopper_update_consumer_feedback(request, pk):
    """Public: attach feedback rating/comment to an existing consumer session."""
    consumer = get_object_or_404(Consumer, pk=pk)
    rating = request.data.get('feedback_rating')
    comment = request.data.get('feedback_comment', '')
    if rating is None:
        return Response({'detail': 'feedback_rating is required.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        return Response({'detail': 'Invalid feedback_rating.'}, status=status.HTTP_400_BAD_REQUEST)
    if rating < 1 or rating > 5:
        return Response({'detail': 'feedback_rating must be 1–5.'}, status=status.HTTP_400_BAD_REQUEST)

    consumer.feedback_rating = rating
    consumer.feedback_comment = str(comment)[:2000]
    consumer.save(update_fields=['feedback_rating', 'feedback_comment', 'updated_at'])
    return Response(ConsumerSerializer(consumer).data)


def shopper_qr_redirect(request, slug):
    """
    Public QR landing URL: http://localhost:8000/shopper/<slug>
    Redirects into the frontend shopper experience for that store.
    """
    store = get_object_or_404(Store, qr_slug=slug)
    frontend = getattr(settings, 'FRONTEND_SHOPPER_URL', 'http://localhost:5173/shopper').rstrip('/')
    return redirect(f'{frontend}?store={store.qr_slug}')


def _target_payload(row):
    ambassador = row.ambassador
    store = row.store
    return {
        'id': row.id,
        'baId': f'api-{ambassador.id}',
        'baName': ambassador.name,
        'baCode': ambassador.ba_code or '',
        'storeId': store.id if store else None,
        'storeName': store.name if store else '',
        'storeCode': (store.store_code or '') if store else '',
        'city': (store.city if store else ambassador.city) or '',
        'month': row.month,
        'targetKg': float(row.target_total),
        'salesKg': float(row.sales_total),
        'lines': row.lines or [],
    }


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def ba_targets(request):
    """
    GET ?month=YYYY-MM — every BA's target for the month (SKU lines included).
    POST {rows: [{baCode, month, lines: [{sku, brand?, qty, sales?, grammage?}]}]} — save SKU targets per BA.
    """
    viewer = viewer_scope(request)  # Head Office, or a supervisor (read only, their stores)
    if viewer is None:
        return Response({'detail': 'Sign in to continue.'}, status=status.HTTP_401_UNAUTHORIZED)
    scope, is_supervisor = viewer
    if request.method == 'POST':
        from .target_sheet import save_ba_sku_targets

        if is_supervisor:
            return Response({'detail': 'Only Head Office sets targets.'}, status=status.HTTP_403_FORBIDDEN)

        rows = request.data.get('rows')
        if not isinstance(rows, list) or not rows:
            return Response({'detail': 'Send at least one BA target.'}, status=status.HTTP_400_BAD_REQUEST)
        result = save_ba_sku_targets([r for r in rows if isinstance(r, dict)], scope)
        return Response(result, status=status.HTTP_201_CREATED if result['saved'] else status.HTTP_400_BAD_REQUEST)

    month = (request.query_params.get('month') or timezone.localdate().strftime('%Y-%m')).strip()
    rows = AmbassadorMonthTarget.objects.select_related('ambassador', 'store').filter(month=month)
    if not scope.is_all:
        # A supervisor sees targets at their own stores (and store-less targets of their BAs).
        by_ba = Q(store__isnull=True, ambassador_id__in=scope.ambassador_ids) if is_supervisor else Q(
            ambassador_id__in=scope.ambassador_ids
        )
        rows = rows.filter(Q(store_id__in=scope.store_ids) | by_ba)
    rows = rows.order_by('ambassador__name')
    return Response({'month': month, 'results': [_target_payload(row) for row in rows]})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ba_targets_upload(request):
    """
    POST multipart {file, month=YYYY-MM}: the store SKU target sheet
    (Region | City | Store name | Brand | SKU Name | KG Count | Count | Grammage).
    Each store's SKU targets are saved for that month on the store's BA(s).
    """
    from .shifts import parse_month
    from .target_sheet import import_store_sku_targets

    upload = request.FILES.get('file')
    parsed = parse_month(request.data.get('month'))
    if not upload:
        return Response({'detail': 'Choose the target Excel file.'}, status=status.HTTP_400_BAD_REQUEST)
    if not parsed:
        return Response({'detail': 'Choose the month (YYYY-MM).'}, status=status.HTTP_400_BAD_REQUEST)
    result = import_store_sku_targets(upload, '%04d-%02d' % parsed, scope_for(request.user))
    code = status.HTTP_201_CREATED if result['saved'] else status.HTTP_400_BAD_REQUEST
    return Response(result, status=code)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ba_targets_template(request):
    """GET ?month=YYYY-MM: Excel template with the SKU column, one block per store and BA (user's city)."""
    from django.http import HttpResponse

    from .shifts import parse_month
    from .target_sheet import build_ba_sku_template

    parsed = parse_month(request.query_params.get('month')) or parse_month(timezone.localdate().strftime('%Y-%m'))
    month = '%04d-%02d' % parsed
    response = HttpResponse(
        build_ba_sku_template(month, scope_for(request.user)),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="Tapal_BA_Target_Template_{month}.xlsx"'
    return response


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def platform_settings(request):
    """
    Read / update platform-wide settings (certification thresholds).
    Admin / Head Office authenticated users.
    """
    cfg = PlatformSettings.get_solo()
    if request.method == 'GET':
        return Response(PlatformSettingsSerializer(cfg).data)

    if not scope_for(request.user).is_all:
        return Response({'detail': 'Only the all-city Head Office can change this setting.'}, status=status.HTTP_403_FORBIDDEN)
    serializer = PlatformSettingsSerializer(cfg, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save(updated_by=request.user)
    return Response(serializer.data)
