"""
Live store numbers worked out from what actually happens, instead of stored counters:

  status / coverage / BAs / assigned  — from this month's shifts, deployments and today's check-ins
  footfall                            — entered daily (by the BA or Head Office); resets each day
  conversion                          — productive UserInterceptions whose previous brand is not Tapal
                                        ÷ total UserInterceptions, per store / BA
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date

from django.utils import timezone

# Typed spellings of Tapal, then competitor names, then Tapal products written without the word Tapal.
_TAPAL_SPELLING = re.compile(
    r'tapal|tapl|tapla|tapql|yapal|tspal|ta\s*pal|taapl|tapa',
    re.IGNORECASE,
)
_COMPETITOR_BRAND = re.compile(
    r'lipton|liptan|liptom|liton|lupton|lioton|tipton|\blip\b|'
    r'vital|vitap|vutal|\bvita\b|\bvit\b|'
    r'supreme|suprem|\bsup\b|'
    r'deer|dear|qamar|meezan|mezan|meeza|nayab|lose\s*tea|ultra\s*rich|green\s*leaf|sleem|zeba',
    re.IGNORECASE,
)
_TAPAL_PRODUCT = re.compile(
    r'daned|danad|danced|dandar|'
    r'tezdum|tez\s*dum|taz\s*dum|tazdum|texdum|tezdam|'
    r'family\s*mix|famil\s*mix|\bfm\b|\btdd\b|\bdd\b|\bgt\b|\btb\b|'
    r'green\s*tea|teabag|tea\s*bag',
    re.IGNORECASE,
)


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
    """Legacy helper: shopper came from another brand (not Tapal). Kept for reports/filters."""
    brand = (previous_brand or '').strip().lower()
    return bool(brand) and 'tapal' not in brand


def is_tapal_previous_brand(previous_brand: str | None) -> bool:
    """True when free text or a dropdown value is Tapal or a Tapal product."""
    brand = (previous_brand or '').strip()
    if not brand:
        return False
    if _TAPAL_SPELLING.search(brand):
        return True
    if _COMPETITOR_BRAND.search(brand):
        return False
    return bool(_TAPAL_PRODUCT.search(brand))


def is_productive_interception(status: str | None, current_sku: str | None = None) -> bool:
    """A call is productive when UserInterception.status is productive."""
    outcome = (status or '').strip()
    if not outcome:
        outcome = 'productive' if (current_sku or '').strip() else 'non_productive'
    return outcome == 'productive'


def is_converted_interception(status: str | None, current_sku: str | None, previous_brand: str | None) -> bool:
    """Productive, and the previous brand is filled in and is not Tapal."""
    brand = (previous_brand or '').strip()
    if not brand or is_tapal_previous_brand(brand):
        return False
    return is_productive_interception(status, current_sku)


def interception_counts(store_ids=None, start: date | None = None, end: date | None = None):
    """
    Conversion buckets use converted ÷ total UserInterceptions.
    Converted = productive and previous brand is not Tapal.
    (per store {id: [converted, total]}, per BA {id: [converted, total]},
     per day {date: converted}, totals [converted, total])
    """
    from .models import UserInterception

    qs = UserInterception.objects.only(
        'store_id', 'ambassador_id', 'status', 'current_sku', 'previous_brand', 'created_at'
    )
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
        converted = is_converted_interception(row.status, row.current_sku, row.previous_brand)
        for bucket in (
            by_store[row.store_id] if row.store_id else None,
            by_ba[row.ambassador_id] if row.ambassador_id else None,
            totals,
        ):
            if bucket is not None:
                bucket[0] += converted
                bucket[1] += 1
        if converted:
            by_day[timezone.localtime(row.created_at).date()] += 1
    return by_store, by_ba, by_day, totals


def ba_call_counts():
    """Each BA's own interceptions: {ambassador_id: [total, productive]}. Non-productive is total minus productive."""
    from .models import UserInterception

    by_ba: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for row in UserInterception.objects.only('ambassador_id', 'status', 'current_sku'):
        if not row.ambassador_id:
            continue
        bucket = by_ba[row.ambassador_id]
        bucket[0] += 1
        if is_productive_interception(row.status, row.current_sku):
            bucket[1] += 1
    return by_ba


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
