from datetime import date, datetime, timedelta

from django.conf import settings
from django.db import transaction
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
    BackupCoverage,
    Consumer,
    DailyReport,
    MisAuditLog,
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
    BackupCoverageSerializer,
    PlatformSettingsSerializer,
    MonthlyShiftSerializer,
    ShiftAssignmentSerializer,
    StoreRewardSerializer,
    StoreSerializer,
    SurveyQuestionSerializer,
)
from .shifts import (
    assign_ba_stores,
    build_attendance,
    business_today,
    create_month_shifts,
    day_key_for,
    drop_pending_daily_rows,
    ensure_daily_rows,
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

    @action(detail=False, methods=['post'], url_path='swap')
    def swap(self, request):
        """Atomically swap the BAs assigned to two monthly shifts."""
        from .models import ShiftAssignment

        raw_ids = request.data.get('shift_ids')
        if not isinstance(raw_ids, list) or len(raw_ids) != 2:
            return Response({'detail': 'Choose exactly two shifts to swap.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            shift_ids = [int(value) for value in raw_ids]
        except (TypeError, ValueError):
            return Response({'detail': 'Shift IDs must be valid.'}, status=status.HTTP_400_BAD_REQUEST)
        if shift_ids[0] == shift_ids[1]:
            return Response({'detail': 'Choose two different shifts.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            shifts = list(
                self.get_queryset().select_for_update().filter(id__in=shift_ids).order_by('id')
            )
            if len(shifts) != 2:
                return Response({'detail': 'One or both shifts were not found.'}, status=status.HTTP_404_NOT_FOUND)
            first, second = shifts
            if first.month != second.month:
                return Response({'detail': 'Both shifts must be in the same month.'}, status=status.HTTP_400_BAD_REQUEST)
            if first.month < timezone.localdate().strftime('%Y-%m'):
                return Response({'detail': 'Past month assignments cannot be changed.'}, status=status.HTTP_400_BAD_REQUEST)
            if not first.ambassador_id or not second.ambassador_id:
                return Response({'detail': 'Both shifts must already have an assigned BA.'}, status=status.HTTP_400_BAD_REQUEST)
            if first.ambassador_id == second.ambassador_id:
                return Response({'detail': 'These shifts are already assigned to the same BA.'}, status=status.HTTP_400_BAD_REQUEST)

            today = business_today()
            preserve_today = first.month == today.strftime('%Y-%m') and ShiftAssignment.objects.filter(
                monthly_shift_id__in=shift_ids,
                date=today,
            ).filter(
                Q(checked_in_at__isnull=False)
                | Q(checked_out_at__isnull=False)
                | Q(report_submitted_at__isnull=False)
            ).exists()

            # Validate the projected assignments before changing either row.
            moved = [(first, second.ambassador_id), (second, first.ambassador_id)]
            from .shifts import _overlaps

            for shift, new_ambassador_id in moved:
                other_shifts = list(
                    MonthlyShift.objects.filter(ambassador_id=new_ambassador_id, month=shift.month).exclude(
                        id__in=shift_ids
                    )
                )
                conflict = next(
                    (
                        other
                        for other in other_shifts
                        if _overlaps(shift.start_time, shift.end_time, other.start_time, other.end_time)
                    ),
                    None,
                )
                if conflict:
                    return Response(
                        {'detail': f'{new_ambassador_id} has overlapping hours at another store in this month.'},
                        status=status.HTTP_409_CONFLICT,
                    )

            first_ba, second_ba = first.ambassador_id, second.ambassador_id
            first.ambassador_id, second.ambassador_id = second_ba, first_ba
            first.status = MonthlyShift.Status.SCHEDULED
            second.status = MonthlyShift.Status.SCHEDULED
            MonthlyShift.objects.filter(id=first.id).update(
                ambassador_id=first.ambassador_id, status=first.status, updated_at=timezone.now()
            )
            MonthlyShift.objects.filter(id=second.id).update(
                ambassador_id=second.ambassador_id, status=second.status, updated_at=timezone.now()
            )

            if first.month == timezone.localdate().strftime('%Y-%m'):
                # Once either BA has started today, keep both today's assignments as they were.
                # The swap then applies to later unchecked-in attendance rows.
                effective_date = today + timedelta(days=1) if preserve_today else today
                first_pending = first.days.filter(
                    date__gte=effective_date,
                    checked_in_at__isnull=True,
                )
                second_pending = second.days.filter(
                    date__gte=effective_date,
                    checked_in_at__isnull=True,
                )
                first_pending.update(ambassador_id=first.ambassador_id, status=first.status)
                second_pending.update(ambassador_id=second.ambassador_id, status=second.status)
                assign_ba_stores(first.month, [first_ba, second_ba])
                for store_id in {first.store_id, second.store_id}:
                    store = Store.objects.filter(pk=store_id).first()
                    if store:
                        store.bas = Ambassador.objects.filter(
                            store_id=store_id, status=Ambassador.Status.DEPLOYED
                        ).count()
                        store.save(update_fields=['bas', 'updated_at'])

        return Response({'detail': 'BA assignments swapped successfully.'})

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
            ShiftAssignment.objects.select_related(
                'store', 'ambassador', 'covered_by', 'coverage_of__ambassador', 'report_owner', 'coverage_assigned_by'
            ).order_by('-date', 'shift_label', 'id')
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

    @action(detail=False, methods=['post'], url_path='cover')
    def cover(self, request):
        """Create ongoing backup coverage for an absent BA at their assigned store."""

        try:
            monthly_shift_id = int(request.data.get('monthly_shift_id'))
            backup_id = int(request.data.get('backup_ambassador_id'))
            starts_on = datetime.strptime(
                str(request.data.get('start_date') or request.data.get('date') or ''), '%Y-%m-%d'
            ).date()
        except (TypeError, ValueError):
            return Response(
                {'detail': 'Choose a scheduled shift, backup BA, and valid coverage start date (YYYY-MM-DD).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        today = timezone.localdate()
        if starts_on < today:
            return Response({'detail': 'Coverage cannot start on a past date.'}, status=status.HTTP_400_BAD_REQUEST)

        scope = scope_for(request.user)
        monthly = scope.stores(
            MonthlyShift.objects.select_related('store', 'ambassador').all()
        ).filter(pk=monthly_shift_id, month=starts_on.strftime('%Y-%m')).first()
        if not monthly or not monthly.ambassador_id:
            return Response({'detail': 'The selected monthly shift is not assigned to a BA.'}, status=status.HTTP_404_NOT_FOUND)
        absent_ba = monthly.ambassador
        backup = Ambassador.objects.filter(
            pk=backup_id,
            is_active=True,
            is_backup=True,
            is_demo=False,
        ).first()
        if not backup:
            return Response({'detail': 'Choose an available BA marked as a backup.'}, status=status.HTTP_400_BAD_REQUEST)
        if backup.id == absent_ba.id:
            return Response({'detail': 'A BA cannot cover their own shift.'}, status=status.HTTP_400_BAD_REQUEST)
        if not scope.allows_ambassador(backup.id):
            return Response({'detail': 'The selected backup BA is outside your city scope.'}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            active_absence = BackupCoverage.objects.select_for_update().filter(
                original_ba=absent_ba,
                store=monthly.store,
            ).filter(Q(ends_on__isnull=True) | Q(ends_on__gte=starts_on)).first()
            if active_absence:
                return Response(
                    {'detail': f'{absent_ba.name} already has backup coverage at this store from {active_absence.starts_on}.'},
                    status=status.HTTP_409_CONFLICT,
                )
            backup_conflict = BackupCoverage.objects.select_for_update().filter(
                backup_ba=backup
            ).filter(Q(ends_on__isnull=True) | Q(ends_on__gte=starts_on)).first()
            if backup_conflict:
                return Response(
                    {'detail': f'{backup.name} is already covering another BA at {backup_conflict.store.name}.'},
                    status=status.HTTP_409_CONFLICT,
                )
            if MonthlyShift.objects.filter(ambassador=backup, month__gte=starts_on.strftime('%Y-%m')).exists():
                return Response(
                    {'detail': 'The backup BA has a monthly shift during this coverage period. Resolve that assignment first.'},
                    status=status.HTTP_409_CONFLICT,
                )
            if ShiftAssignment.objects.filter(ambassador=backup, date=starts_on, coverage_cancelled=False).exists():
                return Response({'detail': 'The backup BA already has a shift on the start date.'}, status=status.HTTP_409_CONFLICT)
            if starts_on == today:
                original = ShiftAssignment.objects.filter(monthly_shift=monthly, date=starts_on).first()
                if original and (original.checked_in_at or original.checked_out_at or original.report_submitted_at):
                    return Response(
                        {'detail': 'The original BA has already started or completed today’s shift.'},
                        status=status.HTTP_409_CONFLICT,
                    )
            coverage = BackupCoverage.objects.create(
                monthly_shift=monthly,
                original_ba=absent_ba,
                backup_ba=backup,
                store=monthly.store,
                starts_on=starts_on,
                assigned_by=request.user if request.user.is_authenticated else None,
            )
        ensure_daily_rows(starts_on, absent_ba)
        return Response(BackupCoverageSerializer(coverage).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='end-coverage')
    def end_coverage(self, request):
        """End ongoing coverage after its final covered day; keep all prior daily records."""
        try:
            coverage_id = int(request.data.get('coverage_id'))
            resume_on = datetime.strptime(
                str(request.data.get('resume_on') or (timezone.localdate() + timedelta(days=1)).isoformat()),
                '%Y-%m-%d',
            ).date()
        except (TypeError, ValueError):
            return Response({'detail': 'Choose a valid date for the original BA to resume (YYYY-MM-DD).'}, status=status.HTTP_400_BAD_REQUEST)
        today = timezone.localdate()
        if resume_on < today:
            return Response({'detail': 'The original BA cannot resume on a past date.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            coverage = scope_for(request.user).stores(
                BackupCoverage.objects.select_for_update().select_related('store', 'original_ba', 'backup_ba')
            ).filter(pk=coverage_id).first()
            if not coverage:
                return Response({'detail': 'Coverage assignment was not found.'}, status=status.HTTP_404_NOT_FOUND)
            if resume_on <= coverage.starts_on:
                return Response(
                    {'detail': f'Choose a resume date after {coverage.starts_on.isoformat()} so the backup’s first covered day is retained.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            ends_on = resume_on - timedelta(days=1)
            if coverage.ended_at or (coverage.ends_on and coverage.ends_on < today):
                return Response({'detail': 'This coverage assignment has already ended.'}, status=status.HTTP_409_CONFLICT)
            worked_after_end = coverage.daily_assignments.filter(
                coverage_of__isnull=False, date__gt=ends_on, checked_in_at__isnull=False
            ).exists()
            if worked_after_end:
                return Response(
                    {'detail': 'The backup BA has already checked in on or after the selected return date. Choose a later return date so their attendance is preserved.'},
                    status=status.HTTP_409_CONFLICT,
                )
            coverage.ends_on = ends_on
            coverage.ended_by = request.user if request.user.is_authenticated else None
            coverage.ended_at = timezone.now()
            coverage.save(update_fields=['ends_on', 'ended_by', 'ended_at'])
            for backup_day in coverage.daily_assignments.filter(
                coverage_of__isnull=False, date__gt=ends_on, checked_in_at__isnull=True
            ).select_related('coverage_of'):
                original_day = backup_day.coverage_of
                if original_day and original_day.covered_by_id == coverage.backup_ba_id:
                    original_day.covered_by = None
                    original_day.save(update_fields=['covered_by', 'updated_at'])
                backup_day.coverage_cancelled = True
                backup_day.save(update_fields=['coverage_cancelled', 'updated_at'])
        return Response(BackupCoverageSerializer(coverage).data)


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
    today = business_today()
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


def _parse_optional_dt(raw):
    """ISO datetime / null / '' → aware datetime or None. Missing key handled by caller."""
    if raw is None or raw == '':
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        value = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Use a valid date and time.') from exc
    if timezone.is_naive(value):
        value = timezone.make_aware(value)
    return value


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def mis_audit_logs(request):
    """
    Standard Head Office (not MIS): list MIS action audit entries.
    Query: ?date_from=&date_to=&action=&q=&limit=
    """
    user = request.user
    if not getattr(user, 'is_head_office', False) and not getattr(user, 'is_staff', False):
        return Response({'detail': 'Head Office only.'}, status=status.HTTP_403_FORBIDDEN)
    if getattr(user, 'is_mis', False):
        return Response({'detail': 'Audit log is not available for MIS accounts.'}, status=status.HTTP_403_FORBIDDEN)

    qs = MisAuditLog.objects.all()
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    action = (request.query_params.get('action') or '').strip()
    if action:
        qs = qs.filter(action=action)
    q = (request.query_params.get('q') or '').strip()
    if q:
        qs = qs.filter(
            Q(actor_email__icontains=q)
            | Q(actor_name__icontains=q)
            | Q(summary__icontains=q)
            | Q(entity_id__icontains=q)
        )

    try:
        limit = min(max(int(request.query_params.get('limit') or 200), 1), 500)
    except (TypeError, ValueError):
        limit = 200

    rows = [
        {
            'id': row.id,
            'at': row.created_at.isoformat(),
            'actorEmail': row.actor_email,
            'actorName': row.actor_name,
            'action': row.action,
            'actionLabel': row.get_action_display(),
            'entityType': row.entity_type,
            'entityId': row.entity_id,
            'summary': row.summary,
            'before': row.before,
            'after': row.after,
            'meta': row.meta,
            'ipAddress': row.ip_address,
        }
        for row in qs[:limit]
    ]
    return Response({'results': rows})


def _clear_today_checkout_reports(ambassador: Ambassador, day: date) -> None:
    """Remove today's checkout/excel DailyReport rows so MIS Data filled / daily reports match."""
    start = timezone.make_aware(datetime.combine(day, datetime.min.time()))
    end = start + timedelta(days=1)
    DailyReport.objects.filter(
        Q(ambassador=ambassador) | Q(submitted_by=ambassador),
        source__in=(DailyReport.Source.CHECKOUT, DailyReport.Source.EXCEL),
        submitted_at__gte=start,
        submitted_at__lt=end,
    ).delete()


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def mis_edit_attendance(request):
    """
    MIS only: set or clear today's check-in / check-out / report for a BA.
    Body: { ambassadorId, checkedInAt?: ISO|null, checkedOutAt?: ISO|null, reportSubmittedAt?: ISO|null }
    Pass null/'' to clear a time. Clearing check-in also clears check-out and data filled.
    """
    if not getattr(request.user, 'is_mis', False):
        return Response({'detail': 'Only MIS can edit attendance times.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        ambassador_id = int(request.data.get('ambassadorId'))
    except (TypeError, ValueError):
        return Response({'detail': 'ambassadorId is required.'}, status=status.HTTP_400_BAD_REQUEST)

    scope = scope_for(request.user)
    if not scope.allows_ambassador(ambassador_id):
        return Response({'detail': 'Ambassador not found.'}, status=status.HTTP_404_NOT_FOUND)

    ambassador = Ambassador.objects.filter(pk=ambassador_id, is_active=True).first()
    if not ambassador:
        return Response({'detail': 'Ambassador not found.'}, status=status.HTTP_404_NOT_FOUND)

    today = business_today()
    ensure_daily_rows(today, ambassador)
    shift = (
        ShiftAssignment.objects.filter(
            ambassador=ambassador,
            date=today,
            coverage_cancelled=False,
            status__in=(ShiftAssignment.Status.SCHEDULED, ShiftAssignment.Status.CONFLICT),
        )
        .order_by('shift_label', 'id')
        .first()
    )
    if not shift:
        return Response({'detail': 'No shift scheduled for today.'}, status=status.HTTP_400_BAD_REQUEST)

    before = {
        'checkedInAt': shift.checked_in_at.isoformat() if shift.checked_in_at else None,
        'checkedOutAt': shift.checked_out_at.isoformat() if shift.checked_out_at else None,
        'reportSubmittedAt': shift.report_submitted_at.isoformat() if shift.report_submitted_at else None,
    }
    data = request.data
    update_fields = ['checked_in_at', 'checked_out_at', 'early_checkout_reason', 'updated_at']
    cleared_report = False
    try:
        if 'checkedInAt' in data:
            shift.checked_in_at = _parse_optional_dt(data.get('checkedInAt'))
            if shift.checked_in_at is None:
                shift.checked_out_at = None
                shift.early_checkout_reason = ''
                shift.report_submitted_at = None
                shift.checkout_report = {}
                cleared_report = True
        if 'checkedOutAt' in data:
            if shift.checked_in_at is None and data.get('checkedOutAt') not in (None, ''):
                return Response(
                    {'detail': 'Set check-in before check-out.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            shift.checked_out_at = _parse_optional_dt(data.get('checkedOutAt'))
            if shift.checked_out_at is None:
                shift.early_checkout_reason = ''
        if 'reportSubmittedAt' in data:
            shift.report_submitted_at = _parse_optional_dt(data.get('reportSubmittedAt'))
            if shift.report_submitted_at is None:
                shift.checkout_report = {}
                cleared_report = True
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if shift.checked_in_at and shift.checked_out_at and shift.checked_out_at < shift.checked_in_at:
        return Response(
            {'detail': 'Check-out must be at or after check-in.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if cleared_report:
        update_fields.extend(['report_submitted_at', 'checkout_report'])
        _clear_today_checkout_reports(ambassador, today)
    elif 'reportSubmittedAt' in data:
        update_fields.append('report_submitted_at')

    shift.save(update_fields=update_fields)
    after = {
        'checkedInAt': shift.checked_in_at.isoformat() if shift.checked_in_at else None,
        'checkedOutAt': shift.checked_out_at.isoformat() if shift.checked_out_at else None,
        'reportSubmittedAt': shift.report_submitted_at.isoformat() if shift.report_submitted_at else None,
    }
    from .audit import changed_fields, log_mis_action
    from .models import MisAuditLog

    diff = changed_fields(before, after)
    if diff['before'] or diff['after']:
        log_mis_action(
            actor=request.user,
            action=MisAuditLog.Action.ATTENDANCE_EDIT,
            entity_type='shift',
            entity_id=shift.id,
            summary=f'Updated attendance for {ambassador.name} ({today.isoformat()})',
            before=diff['before'],
            after=diff['after'],
            meta={
                'ambassadorId': ambassador.id,
                'baName': ambassador.name,
                'date': today.isoformat(),
                'storeId': shift.store_id,
            },
            request=request,
        )
    return Response(
        {
            'id': str(shift.id),
            'ambassadorId': shift.ambassador_id,
            'date': shift.date.isoformat(),
            'checkedInAt': shift.checked_in_at.isoformat() if shift.checked_in_at else None,
            'checkedOutAt': shift.checked_out_at.isoformat() if shift.checked_out_at else None,
            'reportSubmittedAt': shift.report_submitted_at.isoformat() if shift.report_submitted_at else None,
        }
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
    A store's QR link (/shopper/<slug>?store=…&city=…) when the web server hands it to Django instead
    of the React app. Send the shopper to the app's front page with the full path in `go`; the app
    then opens /shopper/<slug> itself (redirecting straight to /shopper/<slug> could loop back here).
    Also covers a refresh on /shopper/survey etc.
    """
    from urllib.parse import urlencode

    frontend = (getattr(settings, 'FRONTEND_BASE_URL', '') or 'http://localhost:5173').rstrip('/')
    target = f'/shopper/{slug}'
    if request.GET:
        target += f'?{request.GET.urlencode()}'
    return redirect(f'{frontend}/?{urlencode({"go": target})}')


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


@api_view(['GET'])
@permission_classes([AllowAny])
def sku_catalogue(request):
    """Every Tapal SKU (range, name, kg per pack) — the BA app's complaint form lists these."""
    from .target_sheet import SKU_CATALOGUE

    return Response(
        {'results': [{'range': brand, 'sku': sku, 'grammage': grams} for brand, sku, grams in SKU_CATALOGUE]}
    )


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def ba_targets(request):
    """
    GET ?month=YYYY-MM — every BA's target for the month (SKU lines included).
    POST {rows: [{baCode, month, lines: [{sku, brand?, kg, sales?, grammage?}]}]} — save SKU targets per BA.
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
