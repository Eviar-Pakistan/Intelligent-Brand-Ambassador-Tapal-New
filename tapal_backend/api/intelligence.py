from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta

from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from .city_scope import ALL, CityScope
from .models import Ambassador, Consumer, ShiftAssignment, Store, SurveyQuestion


def _pct(part: int, whole: int) -> float:
    if whole <= 0:
        return 0.0
    return round((part / whole) * 100, 1)


def _distribution(answers: list[str], options: list[str] | None = None) -> list[dict]:
    """Return percentage rows for answer values."""
    total = len(answers)
    if total == 0:
        keys = options or []
        return [{'name': k, 'value': 0} for k in keys]

    counts = Counter(answers)
    keys = list(options) if options else [k for k, _ in counts.most_common()]
    # Include any unexpected answers
    for key in counts:
        if key not in keys:
            keys.append(key)

    rows = []
    for key in keys:
        rows.append({'name': key, 'value': _pct(counts.get(key, 0), total)})
    return rows


def build_intelligence_overview(scope: CityScope = ALL) -> dict:
    stores = scope.stores(Store.objects.all(), 'id')
    store_count = stores.count()
    active_stores = stores.exclude(status=Store.Status.INACTIVE).count()
    if active_stores == 0:
        active_stores = store_count

    footfall_total = stores.aggregate(total=Sum('today_footfall'))['total'] or 0
    bas_total = stores.aggregate(total=Sum('bas'))['total'] or 0

    consumers = list(scope.stores(Consumer.objects.select_related('store').all()))
    shoppers = len(consumers)
    with_answers = sum(1 for c in consumers if c.answers)
    with_feedback = sum(1 for c in consumers if c.feedback_rating is not None)
    consented = sum(1 for c in consumers if c.consent)

    # Engagement: shoppers reached vs store footfall (fallback to answered share)
    engagement_den = footfall_total if footfall_total > 0 else max(shoppers, 1)
    engagement_rate = _pct(shoppers, engagement_den) if footfall_total > 0 else _pct(with_answers, max(shoppers, 1))
    if footfall_total > 0:
        from .models import UserInterception

        intercepted = scope.stores(UserInterception.objects.all()).count()
        engagement_rate = _pct(shoppers + intercepted, footfall_total)
    if engagement_rate > 100:
        engagement_rate = 100.0

    questions = list(SurveyQuestion.objects.filter(is_active=True).order_by('order'))
    q_by_order = {q.order: q for q in questions}

    # Map answers per question
    answers_by_qid: dict[str, list[str]] = defaultdict(list)
    for c in consumers:
        if not isinstance(c.answers, dict):
            continue
        for qid, answer in c.answers.items():
            if answer:
                answers_by_qid[str(qid)].append(str(answer))

    # Conversion / purchase intent from switch question (order 5) when present
    switch_q = q_by_order.get(5)
    switch_answers: list[str] = []
    if switch_q:
        switch_answers = answers_by_qid.get(str(switch_q.id), [])
    yes = sum(1 for a in switch_answers if a.lower().startswith('yes'))
    maybe = sum(1 for a in switch_answers if 'maybe' in a.lower())
    # Shoppers the BAs intercepted count too: converted = switched from another brand to Tapal.
    from .store_live import interception_counts

    _i_store, _i_ba, i_by_day, (i_switched, i_total) = interception_counts(
        None if scope.is_all else scope.store_ids
    )
    if switch_answers or i_total:
        conversion_rate = _pct(yes + i_switched, len(switch_answers) + i_total)
    elif shoppers:
        # Fallback: feedback given implies completed journey / soft conversion
        conversion_rate = _pct(with_feedback, shoppers)
    else:
        conversion_rate = 0.0
    purchase_intent = (
        _pct(yes + maybe + i_switched, len(switch_answers) + i_total) if (switch_answers or i_total) else conversion_rate
    )

    # 7-day engagement trend (consumer sessions per day)
    today = timezone.localdate()
    start = today - timedelta(days=6)
    daily = (
        scope.stores(Consumer.objects.filter(created_at__date__gte=start))
        .annotate(day=TruncDate('created_at'))
        .values('day')
        .annotate(count=Count('id'))
    )
    by_day = {row['day']: row['count'] for row in daily}
    engagement_trend = []
    for i in range(7):
        d = start + timedelta(days=i)
        count = by_day.get(d, 0)
        engagement_trend.append(
            {
                'day': d.strftime('%a'),
                'date': d.isoformat(),
                'engagement': count,
                'conversion': yes if d == today else 0,  # light signal; chart uses engagement
            }
        )
    # Fill conversion per day properly
    converted_daily = (
        scope.stores(Consumer.objects.filter(created_at__date__gte=start))
        .only('created_at', 'answers')
    )
    conv_by_day: dict = defaultdict(int)
    switch_id = str(switch_q.id) if switch_q else None
    for c in converted_daily:
        d = timezone.localtime(c.created_at).date()
        ans = c.answers if isinstance(c.answers, dict) else {}
        if switch_id and str(ans.get(switch_id, '')).lower().startswith('yes'):
            conv_by_day[d] += 1
        elif not switch_id and c.feedback_rating is not None:
            conv_by_day[d] += 1
    for row in engagement_trend:
        from datetime import date as date_cls

        d = date_cls.fromisoformat(row['date'])
        row['conversion'] = conv_by_day.get(d, 0) + i_by_day.get(d, 0)

    # Insights keyed for UI (map survey orders → chart slots)
    preferred_tea = _distribution(
        answers_by_qid.get(str(q_by_order[1].id), []) if 1 in q_by_order else [],
        q_by_order[1].options if 1 in q_by_order else None,
    )
    purchase_frequency = _distribution(
        answers_by_qid.get(str(q_by_order[2].id), []) if 2 in q_by_order else [],
        q_by_order[2].options if 2 in q_by_order else None,
    )
    family_size = _distribution(
        answers_by_qid.get(str(q_by_order[3].id), []) if 3 in q_by_order else [],
        q_by_order[3].options if 3 in q_by_order else None,
    )
    health_preference = _distribution(
        answers_by_qid.get(str(q_by_order[4].id), []) if 4 in q_by_order else [],
        q_by_order[4].options if 4 in q_by_order else None,
    )
    # Price sensitivity derived from "What matters most" when Price is chosen share + others
    price_sensitivity = []
    if 4 in q_by_order:
        matters = answers_by_qid.get(str(q_by_order[4].id), [])
        price_n = sum(1 for a in matters if 'price' in a.lower())
        brand_n = sum(1 for a in matters if 'brand' in a.lower())
        other_n = max(len(matters) - price_n - brand_n, 0)
        price_sensitivity = [
            {'name': 'High', 'value': _pct(price_n, max(len(matters), 1))},
            {'name': 'Medium', 'value': _pct(other_n, max(len(matters), 1))},
            {'name': 'Low', 'value': _pct(brand_n, max(len(matters), 1))},
        ]

    # Question-titled insights for flexible UI
    insights_by_question = []
    for q in questions:
        insights_by_question.append(
            {
                'question_id': q.id,
                'order': q.order,
                'title': q.text,
                'rows': _distribution(answers_by_qid.get(str(q.id), []), q.options),
            }
        )

    def fmt_footfall(n: int) -> str:
        if n >= 1000:
            val = n / 1000
            text = f'{val:.1f}'.rstrip('0').rstrip('.')
            return f'{text}k'
        return str(n)

    footfall_display = fmt_footfall(footfall_total if footfall_total else shoppers)

    return {
        'kpis': {
            'shoppers_engaged': shoppers,
            'active_stores': active_stores,
            'engagement_rate': engagement_rate,
            'conversion_rate': conversion_rate,
            'total_stores': store_count,
            'total_footfall': footfall_total,
            'total_bas': bas_total,
            'consented': consented,
            'with_feedback': with_feedback,
        },
        'engagement_trend': engagement_trend,
        'consumer_insights': {
            'preferredTea': preferred_tea,
            'familySize': family_size,
            'purchaseFrequency': purchase_frequency,
            'priceSensitivity': price_sensitivity,
            'healthPreference': health_preference,
        },
        'insights_by_question': insights_by_question,
        'shopper_intelligence': {
            'footfall': footfall_display,
            'engagement_rate': f'{engagement_rate}%',
            'purchase_intent': f'{purchase_intent}%',
            'conversion_rate': f'{conversion_rate}%',
        },
    }


def build_store_map_pins(scope: CityScope = ALL) -> list[dict]:
    """Live map pins for Head Office Mapbox map."""
    stores = list(scope.stores(Store.objects.all(), 'id'))
    consumer_counts = {
        row['store_id']: row['c']
        for row in scope.stores(Consumer.objects.all()).values('store_id').annotate(c=Count('id'))
    }

    # Switch intent for conversion per store
    switch_q = SurveyQuestion.objects.filter(is_active=True, order=5).first()
    switch_id = str(switch_q.id) if switch_q else None
    yes_by_store: dict[int, int] = defaultdict(int)
    answered_by_store: dict[int, int] = defaultdict(int)
    if switch_id:
        for c in scope.stores(Consumer.objects.all()).only('store_id', 'answers'):
            ans = c.answers if isinstance(c.answers, dict) else {}
            val = str(ans.get(switch_id, ''))
            if not val:
                continue
            answered_by_store[c.store_id] += 1
            if val.lower().startswith('yes'):
                yes_by_store[c.store_id] += 1

    from .store_live import interception_counts

    i_by_store = interception_counts(None if scope.is_all else scope.store_ids)[0]
    for store_id, (switched, total) in i_by_store.items():
        yes_by_store[store_id] += switched
        answered_by_store[store_id] += total

    pins = []
    for store in stores:
        if store.latitude is None or store.longitude is None:
            store.ensure_coordinates(force=True)
            Store.objects.filter(pk=store.pk).update(
                latitude=store.latitude,
                longitude=store.longitude,
            )

        shoppers = consumer_counts.get(store.id, 0) + i_by_store.get(store.id, [0, 0])[1]
        answered = answered_by_store.get(store.id, 0)
        yes = yes_by_store.get(store.id, 0)
        conversion = _pct(yes, answered) if answered else 0.0
        footfall = store.today_footfall or 0
        engagement = _pct(shoppers, footfall) if footfall else (100.0 if shoppers else 0.0)
        if engagement > 100:
            engagement = 100.0

        if store.status == Store.Status.INACTIVE:
            level = 'low'
        elif conversion >= 40 or engagement >= 70 or shoppers >= 10:
            level = 'high'
        elif conversion >= 20 or engagement >= 40 or shoppers >= 3:
            level = 'medium'
        else:
            level = 'low'

        pins.append(
            {
                'id': store.id,
                'name': store.name,
                'city': store.city,
                'address': store.address,
                'status': store.status,
                'lat': float(store.latitude),
                'lng': float(store.longitude),
                'level': level,
                'shoppers': shoppers,
                'engagement_rate': engagement,
                'conversion_rate': conversion,
                'today_footfall': footfall,
            }
        )
    return pins


def build_ba_leaderboard(scope: CityScope = ALL) -> dict:
    """
    Rank every active BA on what they did in the field this week (all BAs are deployed; training
    is for retraining, so certification status does not affect the ranking):

      points = 50 per day Present (checked in + report + checked out)
             + 20 per day only checked in
             + 10 per shopper intercepted this week
             + 15 per shopper who switched to Tapal (conversion)
             +  2 × this month's target achievement % (capped at 150%)
             + 20 × average shopper rating at their store(s) this month (when there is one)
    """
    from .models import AmbassadorMonthTarget, MonthlyShift, UserInterception
    from .store_live import switched_to_tapal

    today = timezone.localdate()
    week_start = today - timedelta(days=today.weekday())  # Monday
    week_end = week_start + timedelta(days=6)
    month = today.strftime('%Y-%m')

    ambassadors = list(
        scope.ambassadors(Ambassador.objects.filter(is_active=True), 'id').select_related('store').order_by('name')
    )
    ids = [a.id for a in ambassadors]

    # Attendance this week (up to today)
    present: dict[int, set] = defaultdict(set)
    checked_in: dict[int, set] = defaultdict(set)
    for row in ShiftAssignment.objects.filter(
        ambassador_id__in=ids, date__gte=week_start, date__lte=today, checked_in_at__isnull=False
    ).only('ambassador_id', 'date', 'checked_out_at', 'report_submitted_at'):
        checked_in[row.ambassador_id].add(row.date)
        if row.checked_out_at and row.report_submitted_at:
            present[row.ambassador_id].add(row.date)

    # Shoppers intercepted this week, and how many switched to Tapal
    sessions: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for row in UserInterception.objects.filter(ambassador_id__in=ids, created_at__date__gte=week_start).only(
        'ambassador_id', 'previous_brand'
    ):
        sessions[row.ambassador_id][0] += 1
        sessions[row.ambassador_id][1] += switched_to_tapal(row.previous_brand)

    # This month's target achievement
    targets = {
        t.ambassador_id: t
        for t in AmbassadorMonthTarget.objects.filter(ambassador_id__in=ids, month=month).select_related('store')
    }

    # Their stores this month (shifts + deployment) and shopper ratings there
    stores_of: dict[int, set[int]] = defaultdict(set)
    for ambassador_id, store_id in MonthlyShift.objects.filter(ambassador_id__in=ids, month=month).values_list(
        'ambassador_id', 'store_id'
    ):
        stores_of[ambassador_id].add(store_id)
    for ba in ambassadors:
        if ba.store_id:
            stores_of[ba.id].add(ba.store_id)
    rating_sum: dict[int, float] = defaultdict(float)
    rating_n: dict[int, int] = defaultdict(int)
    for store_id, rating in Consumer.objects.filter(
        feedback_rating__isnull=False, created_at__date__gte=today.replace(day=1)
    ).values_list('store_id', 'feedback_rating'):
        rating_sum[store_id] += float(rating)
        rating_n[store_id] += 1

    store_names = dict(Store.objects.filter(id__in={s for v in stores_of.values() for s in v}).values_list('id', 'name'))

    rows: list[dict] = []
    for ba in ambassadors:
        days_present = len(present[ba.id])
        days_in_only = len(checked_in[ba.id] - present[ba.id])
        intercepted, switched = sessions.get(ba.id, [0, 0])
        conversion = _pct(switched, intercepted) if intercepted else 0.0
        target = targets.get(ba.id)
        achievement = (
            round(float(target.sales_total) / float(target.target_total) * 100, 1)
            if target and target.target_total
            else None
        )
        n = sum(rating_n.get(s, 0) for s in stores_of[ba.id])
        rating = round(sum(rating_sum.get(s, 0) for s in stores_of[ba.id]) / n, 1) if n else None

        points = int(
            round(
                days_present * 50
                + days_in_only * 20
                + intercepted * 10
                + switched * 15
                + min(achievement or 0, 150) * 2
                + (rating or 0) * 20
            )
        )
        store_id = next(iter(sorted(stores_of[ba.id])), None) if not ba.store_id else ba.store_id
        rows.append(
            {
                'id': ba.id,
                'name': ba.name,
                'ba_code': ba.ba_code,
                'city': ba.city or (ba.store.city if ba.store_id else ''),
                'status': ba.status,
                'store_id': store_id,
                'store_name': store_names.get(store_id) if store_id else None,
                'overall_score': float(ba.overall_score or 0),
                'points': points,
                'days_present': days_present,
                'check_ins_this_week': days_present + days_in_only,
                'interactions': intercepted,
                'switched': switched,
                'conversion': conversion,
                'target_achievement': achievement,
                'customer_rating': rating,
            }
        )

    rows.sort(key=lambda r: (-r['points'], -r['interactions'], r['name']))
    for i, row in enumerate(rows, start=1):
        row['rank'] = i

    return {
        'week_start': week_start.isoformat(),
        'week_end': week_end.isoformat(),
        'week_label': f"{week_start.strftime('%d %b')} – {week_end.strftime('%d %b %Y')}",
        'results': rows,
    }


def _operations_today(scope: CityScope = ALL) -> dict:
    """Attendance for today, from the daily rows made out of monthly shifts."""
    from .models import MonthlyShift
    from .shifts import ensure_daily_rows

    today = timezone.localdate()
    ensure_daily_rows(today)
    rows = list(scope.stores(ShiftAssignment.objects.filter(date=today).exclude(ambassador_id=None)))
    scheduled = len({r.ambassador_id for r in rows})
    checked_in = {r.ambassador_id for r in rows if r.checked_in_at}
    on_shift = {r.ambassador_id for r in rows if r.checked_in_at and not r.checked_out_at}
    gps_online = {
        r.ambassador_id
        for r in rows
        if r.checked_in_at and not r.checked_out_at and r.check_in_lat is not None
    }

    live_stores = scope.stores(Store.objects.exclude(status=Store.Status.INACTIVE), 'id').count()
    covered = (
        scope.stores(MonthlyShift.objects.filter(month=today.strftime('%Y-%m'), ambassador__isnull=False))
        .values('store_id')
        .distinct()
        .count()
    )
    return {
        'active_bas': len(on_shift),
        'gps_online': len(gps_online),
        'scheduled_today': scheduled,
        'checked_in_today': len(checked_in),
        'attendance_rate': _pct(len(checked_in), scheduled),
        'stores_covered': covered,
        'live_stores': live_stores,
        'store_coverage': _pct(covered, live_stores),
    }


def _conversion_between(start, end, switch_id: str | None, scope: CityScope = ALL) -> float:
    consumers = scope.stores(Consumer.objects.filter(created_at__date__gte=start, created_at__date__lte=end)).only(
        'answers', 'feedback_rating'
    )
    total = converted = 0
    for c in consumers:
        answers = c.answers if isinstance(c.answers, dict) else {}
        if switch_id:
            value = str(answers.get(switch_id, ''))
            if not value:
                continue
            total += 1
            converted += value.lower().startswith('yes')
        else:
            total += 1
            converted += c.feedback_rating is not None
    from .store_live import interception_counts

    _s, _b, _d, (i_switched, i_total) = interception_counts(None if scope.is_all else scope.store_ids, start, end)
    return _pct(converted + i_switched, total + i_total)


def _recommendations(pins: list[dict], covered_store_ids: set[int]) -> list[dict]:
    """Rules over each store's real numbers. Most urgent first."""
    recs = []
    for pin in pins:
        if pin['status'] == Store.Status.INACTIVE:
            continue
        store = f"{pin['name']} · {pin['city']}"
        if pin['id'] not in covered_store_ids:
            recs.append(
                {
                    'priority': 0,
                    'pattern': 'No BA scheduled this month',
                    'action': 'Create a monthly shift so shoppers here are engaged.',
                }
            )
        elif pin['shoppers'] >= 5 and pin['engagement_rate'] >= 50 and pin['conversion_rate'] < 20:
            recs.append(
                {
                    'priority': 1,
                    'pattern': 'High engagement, low conversion',
                    'action': 'Refresh the BA pitch or run a trial-pack offer to turn interest into purchase.',
                }
            )
        elif pin['today_footfall'] >= 50 and pin['engagement_rate'] < 20:
            recs.append(
                {
                    'priority': 2,
                    'pattern': 'High footfall, low engagement',
                    'action': 'Move the BA to peak hours or a more visible spot in the store.',
                }
            )
        else:
            continue
        recs[-1].update(
            {
                'id': pin['id'],
                'store': store,
                'engagement': pin['engagement_rate'],
                'conversion': pin['conversion_rate'],
            }
        )
    recs.sort(key=lambda r: (r['priority'], r['conversion']))
    return recs


def build_campaign_metrics(scope: CityScope = ALL) -> dict:
    """Everything the Head Office Campaign Metrics page shows, from live data (one city when scoped)."""
    from .models import MonthlyShift

    overview = build_intelligence_overview(scope)
    pins = build_store_map_pins(scope)
    operations = _operations_today(scope)

    today = timezone.localdate()
    switch_q = SurveyQuestion.objects.filter(is_active=True, order=5).first()
    switch_id = str(switch_q.id) if switch_q else None
    this_week = _conversion_between(today - timedelta(days=6), today, switch_id, scope)
    last_week = _conversion_between(today - timedelta(days=13), today - timedelta(days=7), switch_id, scope)
    shoppers_today = scope.stores(Consumer.objects.filter(created_at__date=today)).count()

    covered_ids = set(
        scope.stores(MonthlyShift.objects.filter(month=today.strftime('%Y-%m'), ambassador__isnull=False)).values_list(
            'store_id', flat=True
        )
    )
    top_stores = sorted(
        (p for p in pins if p['status'] != Store.Status.INACTIVE),
        key=lambda p: (-p['shoppers'], -p['conversion_rate'], p['name']),
    )[:5]
    first_question = next((q for q in overview['insights_by_question'] if q['rows']), None)

    return {
        'generated_at': timezone.localtime().isoformat(),
        'kpis': {
            **overview['kpis'],
            'shoppers_today': shoppers_today,
            'conversion_this_week': this_week,
            'conversion_last_week': last_week,
        },
        'engagement_trend': overview['engagement_trend'],
        'map_pins': pins,
        'consumer_insight': first_question,
        'shopper_intelligence': overview['shopper_intelligence'],
        'operations': operations,
        'top_bas': build_ba_leaderboard(scope)['results'][:4],
        'recommendations': _recommendations(pins, covered_ids)[:4],
        'top_stores': top_stores,
    }
