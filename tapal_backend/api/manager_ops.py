"""Store Manager field-operations aggregates."""

from __future__ import annotations

from datetime import date

from django.db.models import Avg, Count, Q, Sum
from django.utils import timezone

from .models import Ambassador, Consumer, ShiftAssignment, Store
from .shifts import ensure_daily_rows


def _gps_label(shift: ShiftAssignment) -> str:
    if not shift.checked_in_at:
        return '—'
    if shift.check_in_lat is not None and shift.check_in_lng is not None:
        store = shift.store
        if store.latitude is not None and store.longitude is not None:
            # Rough distance check (~111km per degree)
            dlat = abs(float(shift.check_in_lat) - float(store.latitude))
            dlng = abs(float(shift.check_in_lng) - float(store.longitude))
            approx_m = ((dlat**2 + dlng**2) ** 0.5) * 111_000
            if approx_m <= 250:
                return 'Verified'
            if approx_m <= 1500:
                return 'Nearby'
            return 'Off-site'
        return 'Verified'
    return 'No GPS'


def _attendance_status(shift: ShiftAssignment) -> str:
    if shift.checked_out_at:
        return 'Inactive'
    if shift.checked_in_at:
        return 'Active'
    if shift.status == ShiftAssignment.Status.OPEN:
        return 'Pending'
    return 'Scheduled'


def build_manager_overview(scope=None) -> dict:
    from .city_scope import ALL

    from .shifts import business_today

    scope = scope or ALL
    today = business_today()

    stores_qs = scope.stores(Store.objects.all(), 'id').annotate(
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
    stores = list(stores_qs)
    store_count = len(stores)

    agg = stores_qs.aggregate(
        avg_coverage=Avg('coverage'),
        total_footfall=Sum('today_footfall'),
    )

    ensure_daily_rows(today)
    shifts_today = list(
        scope.stores(ShiftAssignment.objects.filter(date=today))
        .exclude(ambassador_id=None)
        .select_related('store', 'ambassador')
        .order_by('checked_in_at', 'shift_label', 'id')
    )

    live_bas = []
    active = 0
    gps_online = 0
    for shift in shifts_today:
        status = _attendance_status(shift)
        gps = _gps_label(shift)
        if status == 'Active':
            active += 1
            if gps in ('Verified', 'Nearby'):
                gps_online += 1
        live_bas.append(
            {
                'shift_id': str(shift.id),
                'ambassador_id': shift.ambassador_id,
                'name': shift.ambassador.name if shift.ambassador_id else '—',
                'store_id': shift.store_id,
                'store_name': shift.store.name,
                'city': shift.store.city,
                'shift': shift.shift_label,
                'checked_in_at': shift.checked_in_at.isoformat() if shift.checked_in_at else None,
                'checked_out_at': shift.checked_out_at.isoformat() if shift.checked_out_at else None,
                'check_in_lat': shift.check_in_lat,
                'check_in_lng': shift.check_in_lng,
                'gps': gps,
                'status': status,
            }
        )

    # Also surface deployed BAs with no shift today (so manager sees gaps)
    scheduled_ids = {row['ambassador_id'] for row in live_bas if row['ambassador_id']}
    deployed = scope.stores(
        Ambassador.objects.filter(status=Ambassador.Status.DEPLOYED, store_id__isnull=False)
    ).select_related('store')
    for ba in deployed:
        if ba.id in scheduled_ids:
            continue
        live_bas.append(
            {
                'shift_id': None,
                'ambassador_id': ba.id,
                'name': ba.name,
                'store_id': ba.store_id,
                'store_name': ba.store.name if ba.store_id else None,
                'city': ba.store.city if ba.store_id else ba.city,
                'shift': None,
                'checked_in_at': None,
                'checked_out_at': None,
                'check_in_lat': None,
                'check_in_lng': None,
                'gps': '—',
                'status': 'Unscheduled',
            }
        )

    shoppers_today = scope.stores(Consumer.objects.filter(created_at__date=today)).count()

    store_rows = []
    for s in stores:
        store_rows.append(
            {
                'id': s.id,
                'name': s.name,
                'city': s.city,
                'address': s.address,
                'status': s.status,
                'footfall': s.footfall,
                'coverage': s.coverage,
                'bas': int(getattr(s, 'assigned_bas_ann', 0) or s.bas or 0),
                'today_footfall': s.today_footfall,
                'peak_hours': s.peak_hours,
                'shopper_count': int(getattr(s, 'shopper_count_ann', 0) or 0),
                'engagement': None,
                'shopper_url': s.shopper_url,
            }
        )

    primary = stores[0] if stores else None

    return {
        'today': today.isoformat(),
        'summary': {
            'stores': store_count,
            'active_bas': active,
            'gps_online': gps_online,
            'avg_coverage': round(float(agg['avg_coverage'] or 0)),
            'today_footfall': int(agg['total_footfall'] or 0),
            'shoppers_today': shoppers_today,
            'shifts_today': len(shifts_today),
        },
        'primary_store': (
            {
                'id': primary.id,
                'name': primary.name,
                'city': primary.city,
                'coverage': primary.coverage,
                'today_footfall': primary.today_footfall,
            }
            if primary
            else None
        ),
        'live_bas': live_bas,
        'attendance': [row for row in live_bas if row['shift_id']],
        'stores': store_rows,
    }
