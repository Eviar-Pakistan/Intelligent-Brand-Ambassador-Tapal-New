"""Shift scheduling helpers (week board dates, peak detection)."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone


DAY_KEYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')

# Attendance / daily-shift "today" rolls at 5:00 AM Asia/Karachi (not midnight),
# so late checkouts (~1–2 AM) stay on the check-in day.
BUSINESS_DAY_START = time(5, 0)


def business_today(now: datetime | None = None) -> date:
    """Working day for BA attendance: before 05:00 counts as the previous calendar day."""
    local = timezone.localtime(now or timezone.now())
    if local.time() < BUSINESS_DAY_START:
        return local.date() - timedelta(days=1)
    return local.date()


def work_datetime_on(day: date, when: datetime | None = None) -> datetime:
    """
    A timestamp that falls on `day` in the local timezone.
    Keeps the clock time when possible so late-night activity (e.g. 02:00) stays on the check-in day.
    """
    local = timezone.localtime(when or timezone.now())
    if local.date() == day:
        return when or timezone.now()
    return timezone.make_aware(datetime.combine(day, local.time().replace(microsecond=0)))


def monday_of(d: date | None = None) -> date:
    d = d or business_today()
    return d - timedelta(days=d.weekday())  # Monday=0


def build_week_days(week_start: date | None = None) -> list[dict]:
    start = monday_of(week_start) if week_start else monday_of()
    days = []
    for i, key in enumerate(DAY_KEYS):
        d = start + timedelta(days=i)
        days.append(
            {
                'key': key,
                'label': key,
                'date': d.strftime('%d %b'),
                'iso': d.isoformat(),
            }
        )
    return days


def day_key_for(d: date) -> str:
    return DAY_KEYS[d.weekday()]


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year, 12, 31)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start, end


def each_day(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def label_from_times(start: str, end: str) -> str:
    def fmt(hhmm: str) -> str:
        hour, minute = (int(part) for part in hhmm.split(':'))
        suffix = 'AM' if hour < 12 else 'PM'
        hour12 = hour % 12 or 12
        return f'{hour12}:{minute:02d} {suffix}'

    return f'{fmt(start)} – {fmt(end)}'


def peak_matches(shift_label: str, peak_hours: str) -> bool:
    """Heuristic: shift overlaps store peak_hours text."""
    peaks = (peak_hours or '').lower()
    shift = (shift_label or '').lower()
    if not peaks.strip():
        return False
    # Check hour tokens like "12", "6", "5" appearing in both
    for token in ('10', '11', '12', '1', '2', '3', '4', '5', '6', '7', '8', '9'):
        if token in shift and token in peaks:
            return True
    return 'peak' in peaks


def parse_hhmm(raw) -> time | None:
    """'09:30', '9:30', '09:30:00' → time. Anything else → None."""
    text = str(raw or '').strip()
    match = re.fullmatch(r'(\d{1,2}):(\d{2})(?::\d{2})?', text)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def parse_month(raw) -> tuple[int, int] | None:
    """'2026-09' → (2026, 9)."""
    match = re.fullmatch(r'(\d{4})-(\d{1,2})', str(raw or '').strip())
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        return None
    return year, month


def _time_spans(start: time, end: time) -> list[tuple[int, int]]:
    """Minutes-from-midnight spans; overnight (end <= start) wraps past midnight."""
    s = start.hour * 60 + start.minute
    e = end.hour * 60 + end.minute
    if e <= s:
        return [(s, 24 * 60), (0, e)]
    return [(s, e)]


def _overlaps(a_start: time, a_end: time, b_start: time | None, b_end: time | None) -> bool:
    if b_start is None or b_end is None:
        return False
    for a0, a1 in _time_spans(a_start, a_end):
        for b0, b1 in _time_spans(b_start, b_end):
            if a0 < b1 and b0 < a1:
                return True
    return False


def create_month_shifts(rows: list[dict], user=None, scope=None) -> dict:
    """
    Create one monthly shift per row {ba_code, store_code, start_time, end_time, month}.

    Rows with problems are reported and skipped; valid rows are saved.
    A row matching an existing monthly shift (same BA, store, hours and month) is skipped,
    so uploading the same file twice does not duplicate shifts.
    """
    from django.db import transaction

    from .models import Ambassador, Store

    errors: list[str] = []
    plans: list[dict] = []
    seen: set[tuple] = set()

    codes = {str(r.get('ba_code') or '').strip().upper() for r in rows}
    store_codes = {str(r.get('store_code') or '').strip().upper() for r in rows}
    ambassadors = {a.ba_code.upper(): a for a in Ambassador.objects.filter(ba_code__in=codes - {''}, is_active=True)}
    store_qs = Store.objects.filter(store_code__in=store_codes - {''})
    if scope is not None:
        store_qs = scope.stores(store_qs, 'id')  # a city user only schedules their city's stores
    stores = {s.store_code.upper(): s for s in store_qs}

    for index, row in enumerate(rows):
        label = row.get('row') or index + 1
        ba_code = str(row.get('ba_code') or '').strip().upper()
        store_code = str(row.get('store_code') or '').strip().upper()
        start = parse_hhmm(row.get('start_time'))
        end = parse_hhmm(row.get('end_time'))
        month = parse_month(row.get('month'))

        problems = []
        if not ba_code:
            problems.append('BA code is required')
        if not store_code:
            problems.append('Store code is required')
        if start is None:
            problems.append('Start time must be HH:MM')
        if end is None:
            problems.append('End time must be HH:MM')
        # Overnight shifts (e.g. 17:00 → 01:00) are allowed: end before start means next calendar morning.
        if month is None:
            problems.append('Month must be YYYY-MM')

        ambassador = ambassadors.get(ba_code)
        store = stores.get(store_code)
        if ba_code and ambassador is None:
            problems.append(f'No ambassador with BA code {ba_code}')
        if store_code and store is None:
            problems.append(f'No store with store code {store_code}')

        key = (ba_code, store_code, start, end, month)
        if not problems and key in seen:
            problems.append('Duplicate of an earlier row')
        seen.add(key)

        if problems:
            errors.append(f'Row {label} ({ba_code or "no BA code"}): {"; ".join(problems)}.')
            continue
        plans.append({'ambassador': ambassador, 'store': store, 'start': start, 'end': end, 'month': month})

    created = 0
    skipped = 0
    conflicts = 0

    with transaction.atomic():
        for plan in plans:
            month_key = '%04d-%02d' % plan['month']
            if monthly_shift_exists(plan, month_key):
                skipped += 1
                continue
            shift = build_monthly_shift(
                store=plan['store'],
                ambassador=plan['ambassador'],
                month=month_key,
                start=plan['start'],
                end=plan['end'],
                user=user,
            )
            shift.save()
            created += 1
            if shift.status == shift.Status.CONFLICT:
                conflicts += 1

    return {
        'created': created,
        'skipped_existing': skipped,
        'conflicts': conflicts,
        'rows_saved': len(plans),
        'errors': errors,
    }


def monthly_shift_exists(plan: dict, month_key: str) -> bool:
    from .models import MonthlyShift

    return MonthlyShift.objects.filter(
        ambassador=plan['ambassador'],
        store=plan['store'],
        month=month_key,
        start_time=plan['start'],
        end_time=plan['end'],
    ).exists()


def monthly_status(shift) -> str:
    """Open without a BA; Conflict when the BA has overlapping hours elsewhere that month."""
    from .models import MonthlyShift

    if not shift.ambassador_id:
        return MonthlyShift.Status.OPEN
    others = MonthlyShift.objects.filter(ambassador_id=shift.ambassador_id, month=shift.month).exclude(pk=shift.pk)
    clash = any(_overlaps(shift.start_time, shift.end_time, o.start_time, o.end_time) for o in others)
    return MonthlyShift.Status.CONFLICT if clash else MonthlyShift.Status.SCHEDULED


def build_monthly_shift(*, store, ambassador, month: str, start: time, end: time, user=None):
    from .models import MonthlyShift

    label = label_from_times(start.strftime('%H:%M'), end.strftime('%H:%M'))
    shift = MonthlyShift(
        store=store,
        ambassador=ambassador,
        month=month,
        start_time=start,
        end_time=end,
        shift_label=label,
        peak_recommended=peak_matches(label, store.peak_hours or ''),
        created_by=user if user and user.is_authenticated else None,
    )
    shift.status = monthly_status(shift)
    return shift


def assign_ba_stores(month: str | None = None, ambassador_ids=None) -> int:
    """
    Deployment: set each BA's store (api_ambassador.store_id) to the store of their monthly shift
    for `month` (default: this month). A BA with several shifts that month gets the earliest-starting
    one. BAs with no shift that month keep their store. Returns how many BAs changed.
    """
    from .models import Ambassador, MonthlyShift

    month = month or business_today().strftime('%Y-%m')
    shifts = MonthlyShift.objects.filter(month=month, ambassador__isnull=False).order_by('start_time', 'id')
    if ambassador_ids is not None:
        shifts = shifts.filter(ambassador_id__in=list(ambassador_ids))
    store_of: dict[int, int] = {}
    for ambassador_id, store_id in shifts.values_list('ambassador_id', 'store_id'):
        store_of.setdefault(ambassador_id, store_id)
    changed = 0
    now = timezone.now()
    for ba in Ambassador.objects.filter(id__in=store_of):
        store_id = store_of[ba.id]
        if ba.store_id == store_id:
            continue
        ba.store_id = store_id
        ba.deployed_at = ba.deployed_at or now
        ba.save(update_fields=['store', 'deployed_at', 'updated_at'])
        changed += 1
    return changed


_stores_assigned_for_month = ''


def ensure_daily_rows(day: date, ambassador=None) -> None:
    """Create the attendance row for `day` from every assigned monthly shift of that month."""
    global _stores_assigned_for_month
    from .models import BackupCoverage, MonthlyShift, ShiftAssignment
    from .store_live import reset_stale_footfall

    if day == business_today():
        reset_stale_footfall()
        # A new month: BAs move to the stores of their new monthly shifts.
        month = day.strftime('%Y-%m')
        if _stores_assigned_for_month != month:
            assign_ba_stores(month)
            _stores_assigned_for_month = month
    monthly = MonthlyShift.objects.filter(
        month=day.strftime('%Y-%m'), ambassador__isnull=False
    )
    if ambassador is not None:
        monthly = monthly.filter(
            Q(ambassador=ambassador, ambassador__is_active=True)
            | Q(ambassador__backup_coverage_absences__backup_ba=ambassador)
        )
    else:
        # Deactivated BAs get no new attendance days unless an active backup
        # assignment explicitly needs a daily row for the covered shift.
        monthly = monthly.filter(
            Q(ambassador__is_active=True)
            | Q(
                ambassador__backup_coverage_absences__starts_on__lte=day,
                ambassador__backup_coverage_absences__backup_ba__is_active=True,
            ) & (
                Q(ambassador__backup_coverage_absences__ends_on__isnull=True)
                | Q(ambassador__backup_coverage_absences__ends_on__gte=day)
            )
        )
    monthly = monthly.distinct().select_related('store', 'ambassador')
    for shift in monthly:
        original, _ = ShiftAssignment.objects.get_or_create(
            monthly_shift=shift,
            date=day,
            defaults=_daily_fields(shift, day),
        )
        coverage = (
            BackupCoverage.objects.filter(original_ba=shift.ambassador, store=shift.store, starts_on__lte=day)
            .filter(Q(ends_on__isnull=True) | Q(ends_on__gte=day))
            .select_related('backup_ba', 'original_ba')
            .order_by('-starts_on', '-id')
            .first()
        )
        if not coverage or not coverage.backup_ba_id or not coverage.backup_ba.is_active:
            continue
        # A BA who has already started the original shift stays attached to it; never rewrite attendance.
        if original.checked_in_at or original.checked_out_at or original.report_submitted_at:
            continue
        if original.covered_by_id not in (None, coverage.backup_ba_id):
            continue
        now = timezone.now()
        original.covered_by = coverage.backup_ba
        original.coverage_assignment = coverage
        original.coverage_assigned_by = coverage.assigned_by
        original.coverage_assigned_at = coverage.assigned_at
        original.save(update_fields=[
            'covered_by', 'coverage_assignment', 'coverage_assigned_by', 'coverage_assigned_at', 'updated_at'
        ])
        backup_day = ShiftAssignment.objects.filter(
            coverage_assignment=coverage,
            coverage_of__isnull=False,
            date=day,
        ).first()
        if backup_day:
            continue
        if ShiftAssignment.objects.filter(
            ambassador=coverage.backup_ba, date=day, coverage_cancelled=False
        ).exists():
            continue
        ShiftAssignment.objects.create(
            store=original.store,
            ambassador=coverage.backup_ba,
            date=day,
            day_key=day_key_for(day),
            shift_label=original.shift_label,
            start_time=original.start_time,
            end_time=original.end_time,
            peak_recommended=original.peak_recommended,
            status=ShiftAssignment.Status.SCHEDULED,
            coverage_of=original,
            coverage_assignment=coverage,
            report_owner=coverage.original_ba or original.ambassador,
            coverage_assigned_by=coverage.assigned_by,
            coverage_assigned_at=coverage.assigned_at or now,
            created_by=coverage.assigned_by,
        )


def _daily_fields(shift, day: date) -> dict:
    return {
        'store_id': shift.store_id,
        'ambassador_id': shift.ambassador_id,
        'day_key': day_key_for(day),
        'shift_label': shift.shift_label,
        'start_time': shift.start_time,
        'end_time': shift.end_time,
        'peak_recommended': shift.peak_recommended,
        'status': shift.status,
    }


def sync_daily_rows(shift) -> None:
    """After an edit, today's row (if not started yet) follows the monthly shift. Past days keep their record."""
    today = business_today()
    pending = shift.days.filter(date__gte=today, checked_in_at__isnull=True)
    if not shift.ambassador_id or shift.month != today.strftime('%Y-%m'):
        pending.delete()
        return
    for row in pending:
        for field, value in _daily_fields(shift, row.date).items():
            setattr(row, field, value)
        row.save()


def drop_pending_daily_rows(shift) -> None:
    """Before a monthly shift is deleted: remove today's row unless the BA already checked in."""
    shift.days.filter(date__gte=business_today(), checked_in_at__isnull=True).delete()


class Attendance:
    PRESENT = 'Present'
    ON_SHIFT = 'On shift'
    NOT_CHECKED_IN = 'Not checked in'
    ABSENT = 'Absent'


def attendance_status(row, today: date | None = None) -> str:
    """
    Present only after check-in, report submission and check-out.
    A past business day without that is Absent, including a check-in with no report.
    Checkout is allowed until 05:00 after the shift date; after that the day is closed.
    """
    today = today or business_today()
    if row.covered_by_id:
        return Attendance.ABSENT
    if row.checked_out_at and row.report_submitted_at:
        return Attendance.PRESENT
    if row.date == today:
        return Attendance.ON_SHIFT if row.checked_in_at else Attendance.NOT_CHECKED_IN
    return Attendance.ABSENT


MAX_ATTENDANCE_DAYS = 62


def build_attendance(date_from: date, date_to: date, ambassador_id=None, store_id=None, scope=None) -> dict:
    """Daily attendance rows (made from monthly shifts) with a status for each, plus totals."""
    from .models import ShiftAssignment

    today = business_today()
    date_to = min(date_to, today)
    if date_from > date_to:
        date_from = date_to
    date_from = max(date_from, date_to - timedelta(days=MAX_ATTENDANCE_DAYS - 1))

    for day in each_day(date_from, date_to):
        ensure_daily_rows(day)

    qs = (
        ShiftAssignment.objects.filter(date__gte=date_from, date__lte=date_to)
        .exclude(ambassador_id=None)
        .select_related(
            'store', 'ambassador', 'covered_by', 'coverage_of__ambassador', 'report_owner', 'coverage_assigned_by'
        )
        .order_by('-date', 'ambassador__name', 'start_time', 'id')
    )
    if scope is not None:
        qs = scope.stores(qs)
    if ambassador_id:
        qs = qs.filter(ambassador_id=ambassador_id)
    if store_id:
        qs = qs.filter(store_id=store_id)

    def iso(value):
        return value.isoformat() if value else None

    rows = []
    for r in qs:
        rows.append(
            {
                'id': str(r.id),
                'date': r.date.isoformat(),
                'day': r.day_key,
                'baId': r.ambassador_id,
                'baName': r.ambassador.name,
                'baCode': r.ambassador.ba_code,
                'coveredByName': r.covered_by.name if r.covered_by_id else None,
                'coverageOfName': (
                    r.coverage_of.ambassador.name
                    if r.coverage_of_id and r.coverage_of.ambassador_id
                    else None
                ),
                'reportOwnerId': r.report_owner_id or r.ambassador_id,
                'reportOwnerName': r.report_owner.name if r.report_owner_id else r.ambassador.name,
                'coverageAssignedByName': (
                    (r.coverage_assigned_by.get_full_name() or r.coverage_assigned_by.get_username())
                    if r.coverage_assigned_by_id
                    else None
                ),
                'coverageAssignedAt': iso(r.coverage_assigned_at),
                'coverageCancelled': r.coverage_cancelled,
                'storeId': r.store_id,
                'storeName': r.store.name,
                'storeCode': r.store.store_code,
                'city': r.store.city,
                'shift': r.shift_label,
                'checkedInAt': iso(r.checked_in_at),
                'attendanceType': r.attendance_type,
                'checkedOutAt': iso(r.checked_out_at),
                'checkInLat': r.check_in_lat,
                'checkInLng': r.check_in_lng,
                'checkInAccuracy': r.check_in_accuracy_m,
                'checkInPhoto': r.check_in_photo.url if r.check_in_photo else None,
                'checkOutLat': r.check_out_lat,
                'checkOutLng': r.check_out_lng,
                'checkOutAccuracy': r.check_out_accuracy_m,
                'reportSubmittedAt': iso(r.report_submitted_at),
                'earlyCheckoutReason': r.early_checkout_reason or None,
                'status': attendance_status(r, today),
            }
        )

    summary = {
        key: sum(1 for row in rows if row['status'] == value)
        for key, value in (
            ('present', Attendance.PRESENT),
            ('on_shift', Attendance.ON_SHIFT),
            ('not_checked_in', Attendance.NOT_CHECKED_IN),
            ('absent', Attendance.ABSENT),
        )
    }
    summary['early_checkouts'] = sum(1 for row in rows if row['earlyCheckoutReason'])
    summary['total'] = len(rows)
    return {
        'date_from': date_from.isoformat(),
        'date_to': date_to.isoformat(),
        'summary': summary,
        'results': rows,
    }
