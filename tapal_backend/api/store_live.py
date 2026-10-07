"""
Live store numbers worked out from what actually happens, instead of stored counters:

  status / coverage / BAs / assigned  — from this month's shifts, deployments and today's check-ins
  footfall                            — entered daily (by the BA or Head Office); resets each day
  conversion                          — shoppers who switched to Tapal ÷ shoppers engaged, from
                                        BA interceptions (previous brand not Tapal) and shopper
                                        surveys ("Would you switch?" answered Yes)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from django.utils import timezone


# ─── Footfall ────────────────────────────────────────────────────────────────


def reset_stale_footfall() -> None:
    """Footfall is for today only: clear any store whose figure is from an earlier business day."""
    from .models import Store
    from .shifts import business_today

    today = business_today()
    Store.objects.exclude(footfall_date=today).exclude(today_footfall=0).update(today_footfall=0)


def record_footfall(store, count: int, entered_by: str = '') -> None:
    from .models import Store, StoreFootfall
    from .shifts import business_today

    today = business_today()
    StoreFootfall.objects.update_or_create(
        store=store, date=today, defaults={'count': count, 'entered_by': entered_by[:120]}
    )
    Store.objects.filter(pk=store.pk).update(today_footfall=count, footfall_date=today)
    store.today_footfall, store.footfall_date = count, today


# ─── Conversion from BA interceptions ────────────────────────────────────────


def switched_to_tapal(previous_brand: str) -> bool:
    """An intercepted shopper counts as converted when they came from another brand."""
    brand = (previous_brand or '').strip().lower()
    return bool(brand) and 'tapal' not in brand


def interception_counts(store_ids=None, start: date | None = None, end: date | None = None):
    """
    (per store {id: [switched, total]}, per BA {id: [switched, total]}, per day {date: switched}, totals [s, t])
    """
    from .models import UserInterception

    qs = UserInterception.objects.only('store_id', 'ambassador_id', 'previous_brand', 'created_at')
    if store_ids is not None:
        qs = qs.filter(store_id__in=store_ids)
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    by_store: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    by_ba: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    by_day: dict[date, int] = defaultdict(int)
    totals = [0, 0]
    for row in qs:
        switched = switched_to_tapal(row.previous_brand)
        for bucket in (
            by_store[row.store_id] if row.store_id else None,
            by_ba[row.ambassador_id] if row.ambassador_id else None,
            totals,
        ):
            if bucket is not None:
                bucket[0] += switched
                bucket[1] += 1
        if switched:
            by_day[timezone.localtime(row.created_at).date()] += 1
    return by_store, by_ba, by_day, totals


# ─── Status, coverage, BAs ───────────────────────────────────────────────────


def live_store_stats(store_ids) -> dict[int, dict]:
    """For each store: its BAs this month (with On shift / Offline), today's coverage and a status."""
    from .models import Ambassador, MonthlyShift, ShiftAssignment, Store
    from .shifts import business_today, ensure_daily_rows

    store_ids = list(store_ids)
    today = business_today()
    ensure_daily_rows(today)

    people: dict[int, dict[int, str]] = defaultdict(dict)  # store -> {ba id: name}
    for shift in MonthlyShift.objects.filter(
        store_id__in=store_ids, month=today.strftime('%Y-%m'), ambassador__isnull=False, ambassador__is_active=True
    ).select_related('ambassador'):
        people[shift.store_id][shift.ambassador_id] = shift.ambassador.name
    for ba in Ambassador.objects.filter(store_id__in=store_ids, is_active=True).only('id', 'name', 'store_id'):
        people[ba.store_id].setdefault(ba.id, ba.name)

    scheduled: dict[int, set[int]] = defaultdict(set)
    checked_in: dict[int, set[int]] = defaultdict(set)
    on_shift: dict[int, set[int]] = defaultdict(set)
    for row in ShiftAssignment.objects.filter(date=today, store_id__in=store_ids).exclude(ambassador_id=None):
        scheduled[row.store_id].add(row.ambassador_id)
        if row.checked_in_at:
            checked_in[row.store_id].add(row.ambassador_id)
            if not row.checked_out_at:
                on_shift[row.store_id].add(row.ambassador_id)

    inactive = set(Store.objects.filter(id__in=store_ids, status=Store.Status.INACTIVE).values_list('id', flat=True))
    stats = {}
    for sid in store_ids:
        bas = people.get(sid, {})
        planned = len(scheduled[sid])
        present = len(checked_in[sid])
        coverage = round(present / planned * 100) if planned else 0
        if sid in inactive:
            code = Store.Status.INACTIVE
        elif not bas:
            code = Store.Status.PENDING  # shown as NEEDS BA
        elif planned and present >= planned:
            code = Store.Status.LIVE  # shown as Covered
        else:
            code = Store.Status.PARTIAL
        stats[sid] = {
            'status': code,
            'coverage': coverage,
            'bas': len(bas),
            'scheduled_today': planned,
            'checked_in_today': present,
            'assigned': [
                {'id': f'api-{ba_id}', 'name': name, 'state': 'Active' if ba_id in on_shift[sid] else 'Offline'}
                for ba_id, name in sorted(bas.items(), key=lambda item: item[1])
            ],
        }
    return stats
