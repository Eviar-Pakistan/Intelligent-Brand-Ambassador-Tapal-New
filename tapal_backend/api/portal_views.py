"""
Server side for the parts of the app that used to live only in the browser:
supervisors (and their sign-in), journey plans and visits, supervisor notifications,
complaints, BA daily reports and interceptions, early check-outs, KPI settings, the BA's
store list, and the shopper session.

Every response uses the field names of the app's TypeScript types, so screens read
server data exactly as they read their local lists.

Who is asking:
  Head Office  — signed in with the Django JWT (Authorization: Bearer …)
  Supervisor   — X-Supervisor-Token header from /api/supervisor/login/
                 (Head Office can act as a supervisor with ?supervisor=<id> — the portal preview)
  BA           — their invite token (?token=… or "token" in the body)
  Shopper      — no sign-in; the store's QR slug
"""

from __future__ import annotations

import base64
import binascii
import math
import re
import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import (
    Ambassador,
    AmbassadorComplaint,
    Consumer,
    CompetitorFieldConfig,
    DailyReport,
    JourneyPlan,
    JourneyVisit,
    KpiConfig,
    MonthlyShift,
    ShiftAssignment,
    Store,
    Supervisor,
    SupervisorNotification,
    SupervisorToken,
    SurveyQuestion,
    UserInterception,
)
from .city_scope import ALL, CityScope, scope_for
from .serializers import StoreSerializer

WEEKDAYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
MAX_IMAGE_BYTES = 6 * 1024 * 1024


# ─── Who is asking ───────────────────────────────────────────────────────────


def _is_head_office(request) -> bool:
    user = getattr(request, 'user', None)
    return bool(user and user.is_authenticated)


def _supervisor_from_header(request) -> Supervisor | None:
    key = (request.headers.get('X-Supervisor-Token') or '').strip()
    if not key:
        return None
    token = SupervisorToken.objects.select_related('supervisor').filter(key=key).first()
    return token.supervisor if token else None


@dataclass
class Scope:
    head_office: bool = False
    supervisor: Supervisor | None = None
    ambassador: Ambassador | None = None
    city: CityScope = ALL

    @property
    def store_ids(self) -> set[int] | None:
        """Stores this caller may see. None = every store (all-city Head Office)."""
        if self.supervisor is not None:
            return set(self.supervisor.stores.values_list('id', flat=True))
        if self.head_office:
            return None if self.city.is_all else set(self.city.store_ids)
        return set()


def _visible_supervisors(city: CityScope):
    """Supervisors a Head Office user may manage: all, or those in / covering their city."""
    qs = Supervisor.objects.all()
    if city.is_all:
        return qs
    return qs.filter(Q(city__iexact=city.city) | Q(stores__id__in=city.store_ids)).distinct()


def _stores_allowed(city: CityScope, store_ids) -> bool:
    return all(city.allows_store(i) for i in store_ids if str(i).lstrip('-').isdigit())


def _scope(request, *, allow_ba: bool = False) -> Scope | None:
    """Head Office (optionally previewing a supervisor), a supervisor, or — when allowed — a BA."""
    supervisor = _supervisor_from_header(request)
    if supervisor:
        return Scope(supervisor=supervisor)
    if _is_head_office(request):
        city = scope_for(request.user)
        preview = (request.query_params.get('supervisor') or '').strip()
        if preview:
            found = _visible_supervisors(city).filter(pk=preview).first()
            return Scope(head_office=True, supervisor=found, city=city) if found else None
        return Scope(head_office=True, city=city)
    if allow_ba:
        token = request.query_params.get('token') or (request.data.get('token') if hasattr(request, 'data') else None)
        ambassador = _ambassador_from_token(token)
        if ambassador:
            return Scope(ambassador=ambassador)
    return None


def _ambassador_from_token(token) -> Ambassador | None:
    token = str(token or '').strip()
    return Ambassador.objects.filter(invite_token=token, is_active=True).first() if token else None


def _denied():
    return Response({'detail': 'Sign in to continue.'}, status=status.HTTP_401_UNAUTHORIZED)


def _forbidden(message='Head Office only.'):
    return Response({'detail': message}, status=status.HTTP_403_FORBIDDEN)


# ─── Small helpers ───────────────────────────────────────────────────────────


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _client_id(raw, prefix: str) -> str:
    text = str(raw or '').strip()
    if re.fullmatch(r'[A-Za-z0-9_.:-]{1,64}', text):
        return text
    return f'{prefix}-{secrets.token_hex(6)}'


def _when(raw) -> datetime:
    parsed = parse_datetime(str(raw)) if raw else None
    if parsed is None:
        return timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


def _ba_id(ambassador_id) -> str:
    return f'api-{ambassador_id}' if ambassador_id else ''


def _ambassador_pk(ba_id) -> int | None:
    match = re.fullmatch(r'api-(\d+)', str(ba_id or ''))
    return int(match.group(1)) if match else None


def _image_from_data_url(value, name: str) -> ContentFile | None:
    """Photos arrive as data: URLs (the app compresses them). Anything else is ignored."""
    match = re.fullmatch(r'data:image/(png|jpe?g|webp);base64,(.+)', str(value or ''), re.S)
    if not match:
        return None
    try:
        data = base64.b64decode(match.group(2), validate=False)
    except (binascii.Error, ValueError):
        return None
    if not data or len(data) > MAX_IMAGE_BYTES:
        return None
    ext = 'jpg' if match.group(1).startswith('jp') else match.group(1)
    return ContentFile(data, name=f'{name}.{ext}')


def _media_url(request, field) -> str:
    if not field:
        return ''
    try:
        return request.build_absolute_uri(field.url) if request else field.url
    except ValueError:
        return ''


def _monday(value) -> date | None:
    try:
        day = date.fromisoformat(str(value))
    except ValueError:
        return None
    return day - timedelta(days=day.weekday())


def _date_param(request, key) -> date | None:
    try:
        return date.fromisoformat(request.query_params.get(key, ''))
    except ValueError:
        return None


# ─── Supervisors: Head Office management ─────────────────────────────────────


def supervisor_payload(sup: Supervisor) -> dict:
    return {
        'id': sup.id,
        'name': sup.name,
        'phone': sup.phone,
        'email': sup.email,
        'city': sup.city,
        'storeIds': sorted(sup.stores.values_list('id', flat=True)),
        'createdAt': _iso(sup.created_at),
        # The password never leaves the server; the app only needs to know whether one is set.
        'passwordSalt': '',
        'passwordHash': 'set' if sup.password else '',
    }


def _assign_stores(sup: Supervisor, store_ids) -> None:
    """A store belongs to one supervisor, so assigning it here takes it from anyone else."""
    ids = {int(i) for i in store_ids if str(i).lstrip('-').isdigit()}
    Store.objects.filter(supervisor=sup).exclude(id__in=ids).update(supervisor=None)
    Store.objects.filter(id__in=ids).update(supervisor=sup)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def supervisors(request):
    """GET the supervisor list · POST {id?, name, phone, email, city, password, storeIds}."""
    if not _is_head_office(request):
        return _denied()
    city = scope_for(request.user)
    if request.method == 'GET':
        rows = _visible_supervisors(city).prefetch_related('stores')
        return Response({'results': [supervisor_payload(s) for s in rows]})

    data = request.data
    if not _stores_allowed(city, data.get('storeIds') or []):
        return _forbidden('You can only assign stores in your city.')
    name = str(data.get('name') or '').strip()
    email = str(data.get('email') or '').strip()
    if not name or not email:
        return Response({'detail': 'Name and email are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if Supervisor.objects.filter(email__iexact=email).exists():
        return Response({'detail': 'Another supervisor already signs in with this email.'}, status=status.HTTP_400_BAD_REQUEST)
    sup = Supervisor(
        id=_client_id(data.get('id'), 'sup'),
        name=name,
        phone=str(data.get('phone') or '').strip(),
        email=email,
        city=str(data.get('city') or '').strip() or city.city,
    )
    if data.get('password'):
        sup.set_password(str(data['password']))
    try:
        with transaction.atomic():
            sup.save(force_insert=True)
            _assign_stores(sup, data.get('storeIds') or [])
    except IntegrityError:
        return Response({'detail': 'This supervisor already exists.'}, status=status.HTTP_400_BAD_REQUEST)
    return Response(supervisor_payload(sup), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([AllowAny])
def supervisor_detail(request, pk):
    """PATCH {name?, phone?, email?, city?, password?, storeIds?} · DELETE."""
    if not _is_head_office(request):
        return _denied()
    city = scope_for(request.user)
    sup = get_object_or_404(_visible_supervisors(city), pk=pk)
    if 'storeIds' in request.data and not _stores_allowed(city, request.data.get('storeIds') or []):
        return _forbidden('You can only assign stores in your city.')
    if request.method == 'DELETE':
        sup.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    data = request.data
    for field in ('name', 'phone', 'city'):
        if field in data:
            setattr(sup, field, str(data.get(field) or '').strip())
    if 'email' in data:
        email = str(data.get('email') or '').strip()
        if not email:
            return Response({'detail': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if Supervisor.objects.filter(email__iexact=email).exclude(pk=sup.pk).exists():
            return Response({'detail': 'Another supervisor already signs in with this email.'}, status=status.HTTP_400_BAD_REQUEST)
        sup.email = email
    if data.get('password'):
        sup.set_password(str(data['password']))
        sup.tokens.all().delete()  # a new password signs everyone out
    with transaction.atomic():
        sup.save()
        if 'storeIds' in data:
            _assign_stores(sup, data.get('storeIds') or [])
    return Response(supervisor_payload(sup))


# ─── Supervisors: signing in ─────────────────────────────────────────────────


@api_view(['POST'])
@permission_classes([AllowAny])
def supervisor_login(request):
    """POST {email, password} → {token, supervisor}. The token goes in X-Supervisor-Token."""
    email = str(request.data.get('email') or '').strip()
    password = str(request.data.get('password') or '')
    sup = Supervisor.objects.filter(email__iexact=email).first() if email else None
    if not sup or not sup.check_password(password):
        return Response({'detail': 'Incorrect email or password.'}, status=status.HTTP_400_BAD_REQUEST)
    token = SupervisorToken.issue(sup)
    return Response({'token': token.key, 'supervisor': supervisor_payload(sup)})


@api_view(['POST'])
@permission_classes([AllowAny])
def supervisor_logout(request):
    key = (request.headers.get('X-Supervisor-Token') or '').strip()
    if key:
        SupervisorToken.objects.filter(key=key).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([AllowAny])
def supervisor_me(request):
    scope = _scope(request)
    if not scope or not scope.supervisor:
        return _denied()
    return Response({'supervisor': supervisor_payload(scope.supervisor), 'preview': scope.head_office})


# ─── Supervisor portal: stores, BAs, headline numbers ────────────────────────


def _store_status_label(status_value: str) -> str:
    return 'Covered' if status_value == 'LIVE' else 'PARTIAL' if status_value == 'PARTIAL' else 'NEEDS BA'


def build_supervisor_overview(sup: Supervisor, request=None, *, shared=None) -> dict:
    """Stores assigned to the supervisor, the BAs working in them today, and their headline numbers."""
    from .intelligence import build_ba_leaderboard, build_store_map_pins
    from .shifts import ensure_daily_rows

    today = timezone.localdate()
    if shared is None:
        ensure_daily_rows(today)
        shared = {
            'pins': {p['id']: p for p in build_store_map_pins()},
            'ranked': {row['id']: row for row in build_ba_leaderboard()['results']},
            'sessions': dict(
                UserInterception.objects.filter(created_at__date__gte=today - timedelta(days=today.weekday()), ambassador__isnull=False)
                .values_list('ambassador_id')
                .annotate(n=Count('id'))
            ),
        }
    stores = list(Store.objects.filter(supervisor=sup).order_by('name'))
    store_ids = [s.id for s in stores]
    pins = {store_id: shared['pins'][store_id] for store_id in store_ids if store_id in shared['pins']}
    ranked = shared['ranked']

    # Who works where: this month's monthly shifts, plus BAs deployed to the store.
    pairs: dict[tuple[int, int], Ambassador] = {}
    for shift in MonthlyShift.objects.filter(
        store_id__in=store_ids, month=today.strftime('%Y-%m'), ambassador__isnull=False
    ).select_related('ambassador'):
        pairs[(shift.ambassador_id, shift.store_id)] = shift.ambassador
    for ba in Ambassador.objects.filter(store_id__in=store_ids):
        pairs.setdefault((ba.id, ba.store_id), ba)

    today_rows = ShiftAssignment.objects.filter(date=today, store_id__in=store_ids).exclude(ambassador_id=None)
    on_shift = {(r.ambassador_id, r.store_id) for r in today_rows if r.checked_in_at and not r.checked_out_at}
    scheduled = {}
    checked_in = {}
    for r in today_rows:
        scheduled[r.store_id] = scheduled.get(r.store_id, 0) + 1
        if r.checked_in_at:
            checked_in[r.store_id] = checked_in.get(r.store_id, 0) + 1

    week_start = today - timedelta(days=today.weekday())
    sessions = shared['sessions']

    bas = []
    assigned_by_store: dict[int, list] = {sid: [] for sid in store_ids}
    store_names = {s.id: s.name for s in stores}
    for (ba_pk, store_id), ba in sorted(pairs.items(), key=lambda item: item[1].name):
        state = 'Active' if (ba_pk, store_id) in on_shift else 'Offline'
        rank = ranked.get(ba_pk, {})
        bas.append(
            {
                'id': _ba_id(ba_pk),
                'name': ba.name,
                'storeId': store_id,
                'store': store_names[store_id],
                'state': state,
                'conversion': rank.get('conversion', 0.0),
                'points': rank.get('points', 0),
                'sessions': sessions.get(ba_pk, 0),
                'score': round(float(ba.overall_score or 0), 1),
            }
        )
        assigned_by_store[store_id].append({'id': _ba_id(ba_pk), 'name': ba.name, 'state': state})

    store_rows = []
    coverage_values = []
    for store in stores:
        row = StoreSerializer(store, context={'request': request}).data
        pin = pins.get(store.id, {})
        # Coverage today: scheduled BAs who checked in. Falls back to the store's saved coverage.
        coverage = (
            round(checked_in.get(store.id, 0) / scheduled[store.id] * 100)
            if scheduled.get(store.id)
            else int(store.coverage or 0)
        )
        coverage_values.append(coverage)
        store_rows.append(
            {
                **row,
                'coverage': coverage,
                'engagement': pin.get('engagement_rate', row.get('engagement') or 0),
                'conversion': pin.get('conversion_rate', row.get('conversion') or 0),
                'status_label': _store_status_label(store.status),
                'assigned': assigned_by_store[store.id],
            }
        )

    unique = {b['id']: b for b in bas}.values()
    conversions = [b['conversion'] for b in unique]
    mean = lambda xs: round(sum(xs) / len(xs), 1) if xs else 0.0  # noqa: E731
    return {
        'supervisor': supervisor_payload(sup),
        'stores': store_rows,
        'bas': bas,
        'teamConversion': mean(conversions),
        'coverage': mean(coverage_values),
        'todayFootfall': sum(int(s.today_footfall or 0) for s in stores),
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def supervisor_overview(request):
    scope = _scope(request)
    if not scope or not scope.supervisor:
        return _denied()
    return Response(build_supervisor_overview(scope.supervisor, request))


@api_view(['GET'])
@permission_classes([AllowAny])
def supervisor_overviews(request):
    """Head Office: every supervisor's headline numbers (for supervisor incentives)."""
    if not _is_head_office(request):
        return _denied()
    from .intelligence import build_ba_leaderboard, build_store_map_pins
    from .shifts import ensure_daily_rows

    today = timezone.localdate()
    ensure_daily_rows(today)
    shared = {
        'pins': {p['id']: p for p in build_store_map_pins()},
        'ranked': {row['id']: row for row in build_ba_leaderboard()['results']},
        'sessions': dict(
            UserInterception.objects.filter(created_at__date__gte=today - timedelta(days=today.weekday()), ambassador__isnull=False)
            .values_list('ambassador_id')
            .annotate(n=Count('id'))
        ),
    }
    rows = []
    for sup in _visible_supervisors(scope_for(request.user)):
        data = build_supervisor_overview(sup, request, shared=shared)
        rows.append(
            {
                'supervisor_id': sup.id,
                **data,
                'storeCount': len(data['stores']),
                'baCount': len({b['id'] for b in data['bas']}),
            }
        )
    return Response({'results': rows})


# ─── Supervisor notifications ────────────────────────────────────────────────


def notify_supervisor(shift: ShiftAssignment, kind: str) -> None:
    """Called when a BA checks in or out: tells the supervisor of that store."""
    store = shift.store
    if not store.supervisor_id or not shift.ambassador_id:
        return
    at = shift.checked_in_at if kind == 'check-in' else shift.checked_out_at
    at = at or timezone.now()
    verb = 'checked in' if kind == 'check-in' else 'checked out'
    time_label = timezone.localtime(at).strftime('%I:%M %p').lstrip('0')
    notice, created = SupervisorNotification.objects.get_or_create(
        id=f'{kind}-{store.id}-{shift.id}',
        defaults={
            'supervisor_id': store.supervisor_id,
            'message': f'{shift.ambassador.name} {verb} at {store.name} · {time_label}',
            'created_at': at,
        },
    )
    if created:
        # Push to the supervisor's phone from the server (not from the BA's app).
        from .push_views import send_push_later

        send_push_later(
            store.supervisor_id,
            'BA checked in' if kind == 'check-in' else 'BA checked out',
            notice.message,
            event_id=notice.id,
        )


@api_view(['GET', 'DELETE'])
@permission_classes([AllowAny])
def supervisor_notifications(request):
    """GET the supervisor's latest notifications · DELETE clears them."""
    scope = _scope(request)
    if not scope or not scope.supervisor:
        return _denied()
    qs = SupervisorNotification.objects.filter(supervisor=scope.supervisor)
    if request.method == 'DELETE':
        qs.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(
        {
            'results': [
                {'id': n.id, 'supervisorId': n.supervisor_id, 'message': n.message, 'createdAt': _iso(n.created_at)}
                for n in qs[:40]
            ]
        }
    )


# ─── Journey plans and visits ────────────────────────────────────────────────


def _plan_payload(plan: JourneyPlan) -> dict:
    return {
        'id': plan.id,
        'supervisorId': plan.supervisor_id,
        'weekStart': plan.week_start.isoformat(),
        'stops': plan.stops,
        'createdAt': _iso(plan.created_at),
        'updatedAt': _iso(plan.updated_at),
    }


def _clean_stops(raw) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    seen, stops = set(), []
    for stop in raw:
        if not isinstance(stop, dict) or stop.get('day') not in WEEKDAYS:
            return None
        try:
            store_id = int(stop.get('storeId'))
        except (TypeError, ValueError):
            return None
        key = (stop['day'], store_id)
        if key not in seen:
            seen.add(key)
            stops.append({'day': stop['day'], 'storeId': store_id})
    stops.sort(key=lambda s: (WEEKDAYS.index(s['day']), s['storeId']))
    return stops


@api_view(['GET', 'PUT'])
@permission_classes([AllowAny])
def journey_plans(request):
    """
    GET plans (Head Office: all, or ?supervisor=; a supervisor: their own).
    PUT {supervisorId, weekStart, stops, id?} — Head Office replaces the week's stops; empty stops remove it.
    """
    scope = _scope(request)
    if not scope:
        return _denied()
    if request.method == 'GET':
        qs = JourneyPlan.objects.all()
        if scope.supervisor:
            qs = qs.filter(supervisor=scope.supervisor)
        elif not scope.city.is_all:
            qs = qs.filter(supervisor__in=_visible_supervisors(scope.city))
        return Response({'results': [_plan_payload(p) for p in qs]})

    if not scope.head_office:
        return _forbidden()
    sup = _visible_supervisors(scope.city).filter(pk=request.data.get('supervisorId')).first()
    week_start = _monday(request.data.get('weekStart'))
    stops = _clean_stops(request.data.get('stops'))
    if not sup or not week_start or stops is None:
        return Response({'detail': 'Give a supervisor, a week and the stops.'}, status=status.HTTP_400_BAD_REQUEST)
    if not _stores_allowed(scope.city, [s['storeId'] for s in stops]):
        return _forbidden('You can only plan visits to stores in your city.')
    known = set(Store.objects.filter(id__in=[s['storeId'] for s in stops]).values_list('id', flat=True))
    if any(s['storeId'] not in known for s in stops):
        return Response({'detail': 'One of the stores no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)
    existing = JourneyPlan.objects.filter(supervisor=sup, week_start=week_start).first()
    if not stops:
        if existing:
            existing.delete()
        return Response({'plan': None})
    plan = existing or JourneyPlan(id=_client_id(request.data.get('id'), 'plan'), supervisor=sup, week_start=week_start)
    plan.stops = stops
    plan.save()
    return Response({'plan': _plan_payload(plan)})


def _visit_payload(visit: JourneyVisit, request) -> dict:
    return {
        'id': visit.id,
        'supervisorId': visit.supervisor_id,
        'weekStart': visit.week_start.isoformat(),
        'day': visit.day,
        'storeId': visit.store_id,
        'latitude': visit.latitude,
        'longitude': visit.longitude,
        'accuracy': visit.accuracy,
        'selfie': _media_url(request, visit.selfie),
        'baPhoto': _media_url(request, visit.ba_photo),
        'stockPhoto': _media_url(request, visit.stock_photo),
        'completedAt': _iso(visit.completed_at),
    }


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def journey_visits(request):
    """
    GET completed visits (Head Office: all or ?supervisor=; a supervisor: their own).
    POST {weekStart, day, storeId, latitude, longitude, accuracy, selfie, baPhoto, stockPhoto} — the supervisor
    completes a planned stop. Photos are data: URLs. Completing the same stop again replaces it.
    """
    scope = _scope(request)
    if not scope:
        return _denied()
    if request.method == 'GET':
        qs = JourneyVisit.objects.all()
        if scope.supervisor:
            qs = qs.filter(supervisor=scope.supervisor)
        elif scope.store_ids is not None:
            qs = qs.filter(store_id__in=scope.store_ids)
        return Response({'results': [_visit_payload(v, request) for v in qs]})

    sup = scope.supervisor
    if not sup:
        return _forbidden('Only the supervisor completes a visit.')
    data = request.data
    week_start = _monday(data.get('weekStart'))
    day = data.get('day')
    try:
        store_id = int(data.get('storeId'))
        latitude = float(data.get('latitude'))
        longitude = float(data.get('longitude'))
    except (TypeError, ValueError):
        return Response({'detail': 'A store and your location are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if not week_start or day not in WEEKDAYS:
        return Response({'detail': 'Give the week and day of the visit.'}, status=status.HTTP_400_BAD_REQUEST)
    plan = JourneyPlan.objects.filter(supervisor=sup, week_start=week_start).first()
    if not plan or {'day': day, 'storeId': store_id} not in plan.stops:
        return Response({'detail': 'This stop is not on your journey plan.'}, status=status.HTTP_400_BAD_REQUEST)
    photos = {}
    for key, field in (('selfie', 'selfie'), ('baPhoto', 'ba_photo'), ('stockPhoto', 'stock_photo')):
        photos[field] = _image_from_data_url(data.get(key), f'{sup.id}-{week_start}-{day}-{store_id}-{field}')
        if photos[field] is None:
            return Response({'detail': 'Take all three photos (selfie, BA and stock).'}, status=status.HTTP_400_BAD_REQUEST)
    accuracy = data.get('accuracy')
    try:
        accuracy = float(accuracy) if accuracy not in (None, '') else None
    except (TypeError, ValueError):
        accuracy = None

    with transaction.atomic():
        existing = JourneyVisit.objects.filter(supervisor=sup, week_start=week_start, day=day, store_id=store_id).first()
        visit = existing or JourneyVisit(
            id=_client_id(data.get('id'), 'visit'), supervisor=sup, week_start=week_start, day=day, store_id=store_id
        )
        visit.latitude, visit.longitude, visit.accuracy = latitude, longitude, accuracy
        visit.completed_at = timezone.now()
        for field, content in photos.items():
            getattr(visit, field).save(content.name, content, save=False)
        visit.save()
    return Response(_visit_payload(visit, request), status=status.HTTP_201_CREATED)


# ─── Complaints ──────────────────────────────────────────────────────────────


def complaint_payload(c: AmbassadorComplaint, request) -> dict:
    base = {
        'id': c.client_id or f'cmp-{c.pk}',
        'kind': c.kind,
        'baId': _ba_id(c.ambassador_id),
        'baName': c.ba_name or (c.ambassador.name if c.ambassador_id else ''),
        'storeId': c.store_id,
        'storeName': c.store.name,
        'city': c.store.city,
        'status': c.status,
        'createdAt': _iso(c.created_at),
        'updatedAt': _iso(c.updated_at),
    }
    if c.ho_note:
        base['hoNote'] = c.ho_note
    if c.kind == AmbassadorComplaint.Kind.CUSTOMER:
        base.update(
            {
                'brand': c.brand,
                'sku': c.sku,
                'customerName': c.customer_name,
                'customerNumber': c.customer_number,
                'complaint': c.complaint,
            }
        )
        if c.image:
            base['image'] = _media_url(request, c.image)
    else:
        base.update({'category': c.category or 'Other', 'subject': c.subject, 'details': c.complaint})
    return base


def _complaint_by_id(pk) -> AmbassadorComplaint | None:
    qs = AmbassadorComplaint.objects.select_related('store', 'ambassador')
    found = qs.filter(client_id=pk).first()
    if not found and re.fullmatch(r'cmp-\d+', str(pk)):
        found = qs.filter(pk=int(str(pk)[4:]), client_id__isnull=True).first()
    return found


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def complaints(request):
    """
    GET complaints (Head Office: all; supervisor: their stores).
    POST — a BA files one with their invite token: {token, id?, kind, storeId, …customer or BA fields}.
    """
    if request.method == 'GET':
        scope = _scope(request, allow_ba=True)
        if not scope:
            return _denied()
        qs = AmbassadorComplaint.objects.select_related('store', 'ambassador')
        if scope.ambassador:
            qs = qs.filter(ambassador=scope.ambassador)
        elif scope.store_ids is not None:
            qs = qs.filter(store_id__in=scope.store_ids)
        return Response({'results': [complaint_payload(c, request) for c in qs]})

    data = request.data
    ambassador = _ambassador_from_token(data.get('token'))
    if not ambassador:
        return Response({'detail': 'Open the app from your account link to file a complaint.'}, status=status.HTTP_401_UNAUTHORIZED)
    store = Store.objects.filter(pk=data.get('storeId')).first()
    if not store:
        return Response({'detail': 'Choose a store.'}, status=status.HTTP_400_BAD_REQUEST)
    if store.id not in _ba_store_ids(ambassador):
        return Response({'detail': 'You can only file complaints for your own store.'}, status=status.HTTP_400_BAD_REQUEST)
    kind = data.get('kind')
    client_id = _client_id(data.get('id'), 'cmp')
    existing = AmbassadorComplaint.objects.filter(client_id=client_id).first()
    if existing:
        return Response(complaint_payload(existing, request))

    complaint = AmbassadorComplaint(
        client_id=client_id,
        ambassador=ambassador,
        ba_name=str(data.get('baName') or ambassador.name)[:120],
        store=store,
    )
    if kind == 'customer':
        fields = {k: str(data.get(k) or '').strip() for k in ('brand', 'sku', 'customerName', 'customerNumber', 'complaint')}
        missing = [k for k in ('brand', 'sku', 'customerName', 'customerNumber', 'complaint') if not fields[k]]
        if missing:
            return Response({'detail': 'Fill in the brand, SKU, customer and complaint.'}, status=status.HTTP_400_BAD_REQUEST)
        complaint.kind = AmbassadorComplaint.Kind.CUSTOMER
        complaint.brand, complaint.sku = fields['brand'][:80], fields['sku'][:80]
        complaint.customer_name, complaint.customer_number = fields['customerName'][:120], fields['customerNumber'][:30]
        complaint.complaint = fields['complaint'][:2000]
        image = _image_from_data_url(data.get('image'), f'{client_id}-image')
    elif kind == 'ba':
        subject = str(data.get('subject') or '').strip()
        details = str(data.get('details') or '').strip()
        if not subject or not details:
            return Response({'detail': 'Give a subject and the details.'}, status=status.HTTP_400_BAD_REQUEST)
        complaint.kind = AmbassadorComplaint.Kind.BA
        complaint.category = str(data.get('category') or 'Other')[:60]
        complaint.subject, complaint.complaint = subject[:200], details[:2000]
        image = None
    else:
        return Response({'detail': 'Unknown complaint type.'}, status=status.HTTP_400_BAD_REQUEST)

    complaint.save()
    if image:
        complaint.image.save(image.name, image, save=True)
    return Response(complaint_payload(complaint, request), status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([AllowAny])
def complaint_detail(request, pk):
    """Head Office: PATCH {status, hoNote?}."""
    if not _is_head_office(request):
        return _denied()
    complaint = _complaint_by_id(pk)
    if not complaint or not scope_for(request.user).allows_store(complaint.store_id):
        return Response({'detail': 'Complaint not found.'}, status=status.HTTP_404_NOT_FOUND)
    new_status = request.data.get('status')
    if new_status is not None:
        if new_status not in AmbassadorComplaint.Status.values:
            return Response({'detail': 'Unknown status.'}, status=status.HTTP_400_BAD_REQUEST)
        complaint.status = new_status
    if 'hoNote' in request.data:
        complaint.ho_note = str(request.data.get('hoNote') or '').strip()[:2000]
    complaint.save()
    return Response(complaint_payload(complaint, request))


# ─── BA daily reports ────────────────────────────────────────────────────────


def report_payload(r: DailyReport) -> dict:
    return {
        'id': r.id,
        'baId': _ba_id(r.ambassador_id),
        'baName': r.ba_name,
        'baCode': r.ambassador.ba_code if r.ambassador_id else '',
        'submittedById': _ba_id(r.submitted_by_id),
        'submittedByName': r.submitted_by.name if r.submitted_by_id else r.ba_name,
        'storeId': r.store_id,
        'storeName': r.store.name if r.store_id else '',
        'city': r.city,
        'submittedAt': _iso(r.submitted_at),
        'source': r.source,
        'stock': r.stock,
        'sales': r.sales,
        'otherBrands': r.other_brands,
    }


def _mis_patch_daily_report(request, scope: Scope):
    """MIS may correct stock condition, sales quantities, and competitor prices on an existing report."""
    if not scope.head_office or scope.supervisor is not None:
        return _forbidden('Only MIS Head Office can edit daily reports.')
    user = request.user
    if not getattr(user, 'is_mis', False):
        return _forbidden('Only MIS can edit daily reports.')

    report_id = str(request.data.get('id') or '').strip()
    if not report_id:
        return Response({'detail': 'Report id is required.'}, status=status.HTTP_400_BAD_REQUEST)

    report = (
        DailyReport.objects.select_related('ambassador', 'submitted_by', 'store')
        .filter(pk=report_id)
        .first()
    )
    if not report:
        return Response({'detail': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)
    if not scope.city.is_all:
        allowed = (
            (report.store_id and scope.city.allows_store(report.store_id))
            or (report.ambassador_id and scope.city.allows_ambassador(report.ambassador_id))
        )
        if not allowed:
            return Response({'detail': 'Report not found.'}, status=status.HTTP_404_NOT_FOUND)

    before = {
        'stock': report.stock,
        'sales': report.sales,
        'otherBrands': report.other_brands,
    }
    touched: list[str] = []
    data = request.data
    if 'stock' in data:
        stock = data.get('stock') if isinstance(data.get('stock'), dict) else None
        if stock is None:
            return Response({'detail': 'Stock must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
        report.stock = {str(k): str(v or '').strip() for k, v in stock.items()}
        touched.append('stock')

    if 'sales' in data:
        sales = data.get('sales') if isinstance(data.get('sales'), dict) else None
        if sales is None:
            return Response({'detail': 'Sales must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
        sales = {str(k): str(v or '').strip() for k, v in sales.items()}
        sales.pop('totalSalesKg', None)
        for key, value in sales.items():
            if str(key).startswith('unit:') and value and not re.fullmatch(r'\d+', value):
                return Response(
                    {'detail': f'{str(key)[5:]}: sales are in units, so enter a whole number (no decimals).'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        sales['totalSalesKg'] = _total_sales_kg(sales)
        report.sales = sales
        touched.append('sales')

    if 'otherBrands' in data:
        others = data.get('otherBrands') if isinstance(data.get('otherBrands'), list) else None
        if others is None:
            return Response({'detail': 'Competitor data must be a list.'}, status=status.HTTP_400_BAD_REQUEST)
        cleaned = []
        for row in others:
            if not isinstance(row, dict):
                continue
            cleaned.append(
                {
                    'id': str(row.get('id') or '')[:64],
                    'name': str(row.get('name') or '').strip()[:120],
                    'price': str(row.get('price') or '').strip()[:40],
                }
            )
        report.other_brands = cleaned
        touched.append('competitors')

    report.save(update_fields=['stock', 'sales', 'other_brands'])
    after = {
        'stock': report.stock,
        'sales': report.sales,
        'otherBrands': report.other_brands,
    }
    ba_name = report.ambassador.name if report.ambassador_id else ''
    from .audit import changed_fields, log_mis_action
    from .models import MisAuditLog

    diff = changed_fields(before, after)
    if diff['before'] or diff['after']:
        log_mis_action(
            actor=user,
            action=MisAuditLog.Action.DAILY_REPORT_EDIT,
            entity_type='daily_report',
            entity_id=report.pk,
            summary=f"Edited {', '.join(touched) or 'report'} for {ba_name or 'BA'} ({report.source})",
            before=diff['before'],
            after=diff['after'],
            meta={
                'baId': report.ambassador_id,
                'baName': ba_name,
                'storeId': report.store_id,
                'storeName': report.store.name if report.store_id else '',
                'source': report.source,
                'fields': touched,
            },
            request=request,
        )
    if report.ambassador_id and 'sales' in data:
        from .target_sheet import recompute_target_sales

        recompute_target_sales(report.ambassador_id, timezone.localtime(report.submitted_at).strftime('%Y-%m'))
    return Response(report_payload(report))


def _ba_store(ambassador: Ambassador) -> Store | None:
    """The store the BA works at today (their shift), else the store they are deployed to."""
    today = timezone.localdate()
    shift = (
        MonthlyShift.objects.filter(ambassador=ambassador, month=today.strftime('%Y-%m'))
        .select_related('store')
        .order_by('start_time')
        .first()
    )
    return shift.store if shift else ambassador.store


def _ba_visible(qs, scope: Scope, store_field='store'):
    """Head Office sees all; a supervisor sees their stores; a BA sees their own."""
    if scope.ambassador:
        return qs.filter(ambassador=scope.ambassador)
    if scope.supervisor is None and scope.head_office and not scope.city.is_all:
        return qs.filter(
            Q(**{f'{store_field}_id__in': scope.city.store_ids}) | Q(ambassador_id__in=scope.city.ambassador_ids)
        )
    if scope.store_ids is not None:
        return qs.filter(**{f'{store_field}_id__in': scope.store_ids})
    return qs


def _total_sales_kg(sales: dict) -> float:
    """Calculate total kg from SKU quantities in the sales JSON."""
    from .target_sheet import GRAMMAGE, canonical_sku

    total = 0.0
    for key, value in sales.items():
        key = str(key)
        try:
            quantity = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(quantity) or quantity < 0:
            continue
        if key.startswith('unit:'):
            grams = GRAMMAGE.get(canonical_sku(key[len('unit:'):]) or '', 0)
            total += quantity * grams
        elif key.startswith('sku:'):
            # Compatibility with older reports where SKU values were already in kg.
            total += quantity
    return round(total, 3)


@api_view(['GET', 'POST', 'PATCH'])
@permission_classes([AllowAny])
def daily_reports(request):
    """GET reports · POST (BA submit) · PATCH (MIS Head Office edits stock/sales/competitors)."""
    scope = _scope(request, allow_ba=True)
    if not scope:
        return _denied()
    if request.method == 'GET':
        qs = DailyReport.objects.select_related('ambassador', 'submitted_by', 'store')
        if scope.ambassador:
            qs = qs.filter(Q(ambassador=scope.ambassador) | Q(submitted_by=scope.ambassador))
        else:
            qs = _ba_visible(qs, scope)
        return Response({'results': [report_payload(r) for r in qs[:500]]})

    if request.method == 'PATCH':
        return _mis_patch_daily_report(request, scope)

    if not scope.ambassador:
        return _forbidden('Only a BA submits a daily report.')
    data = request.data
    source = data.get('source')
    if source not in DailyReport.Source.values:
        return Response({'detail': 'Unknown report source.'}, status=status.HTTP_400_BAD_REQUEST)
    stock = data.get('stock') if isinstance(data.get('stock'), dict) else {}
    sales = data.get('sales') if isinstance(data.get('sales'), dict) else {}
    # Ignore any client-supplied total; it is calculated below from submitted SKU values.
    sales.pop('totalSalesKg', None)
    others = data.get('otherBrands') if isinstance(data.get('otherBrands'), list) else []
    if not (stock or sales or others):
        return Response({'detail': 'The report is empty.'}, status=status.HTTP_400_BAD_REQUEST)
    sales['totalSalesKg'] = _total_sales_kg(sales)
    for key, value in sales.items():
        # SKU sales are counted in units: whole packs only.
        if str(key).startswith('unit:') and str(value).strip() and not re.fullmatch(r'\d+', str(value).strip()):
            return Response(
                {'detail': f'{str(key)[5:]}: sales are in units, so enter a whole number (no decimals).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
    report_id = _client_id(data.get('id'), 'rep')
    from .ba_attendance_views import _today_shift_for
    from .shifts import business_today, work_datetime_on

    submitted_at = _when(data.get('submittedAt'))
    submission_day = timezone.localtime(submitted_at).date()
    active_shift = (
        ShiftAssignment.objects.filter(
            ambassador=scope.ambassador,
            date=submission_day,
            coverage_of__isnull=False,
            coverage_cancelled=False,
        )
        .select_related('store', 'report_owner')
        .first()
    )
    if not active_shift and submission_day in (business_today(), timezone.localdate()):
        active_shift = _today_shift_for(scope.ambassador)
    # Checkout / anytime sales belong on the check-in (shift) day, not calendar midnight.
    if source in (DailyReport.Source.CHECKOUT, DailyReport.Source.ANYTIME) and active_shift:
        submitted_at = work_datetime_on(active_shift.date, submitted_at)
    report_owner = (
        Ambassador.objects.filter(pk=active_shift.report_owner_id).first()
        if active_shift and active_shift.report_owner_id
        else scope.ambassador
    )
    report_store = active_shift.store if active_shift else _ba_store(report_owner)
    report, created = DailyReport.objects.get_or_create(
        id=report_id,
        defaults={
            'ambassador': report_owner,
            'submitted_by': scope.ambassador,
            'ba_name': report_owner.name[:120],
            'store': report_store,
            'city': (report_store.city if report_store else report_owner.city) or '',
            'source': source,
            'stock': stock,
            'sales': sales,
            'other_brands': others,
            'submitted_at': submitted_at,
            # Only an explicit true counts. Kept for checking in the database; never returned (see report_payload).
            'no_sales_confirmed': data.get('noSalesConfirmed') is True,
        },
    )
    if created and report.ambassador_id:
        # Target achievement = kg the BA reports per target SKU ÷ target kg.
        from .target_sheet import recompute_target_sales

        recompute_target_sales(report.ambassador_id, timezone.localtime(report.submitted_at).strftime('%Y-%m'))
    return Response(report_payload(report), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([AllowAny])
def stock_board(request):
    """Head Office / supervisor: each store's stock status per SKU, from the latest stock report filed there."""
    scope = _scope(request)
    if not scope:
        return _denied()
    qs = (
        _ba_visible(DailyReport.objects.select_related('store'), scope)
        .filter(store__isnull=False)
        .exclude(stock={})
        .only('store__name', 'store__city', 'ba_name', 'submitted_at', 'stock')
    )
    latest: dict[int, DailyReport] = {}
    for report in qs.iterator():  # newest first
        if report.store_id in latest or not any(str(v or '').strip() for v in report.stock.values()):
            continue
        latest[report.store_id] = report
    rows = [
        {
            'storeId': r.store_id,
            'storeName': r.store.name,
            'city': r.store.city,
            'baName': r.ba_name,
            'submittedAt': _iso(r.submitted_at),
            'stock': r.stock,
        }
        for r in latest.values()
    ]
    rows.sort(key=lambda row: (row['city'].lower(), row['storeName'].lower()))
    return Response({'results': rows})


# ─── BA user interceptions ───────────────────────────────────────────────────


def _parse_purchased_skus(current: str) -> list[dict]:
    """Parse 'SKU × 2, Other SKU x 1' (or plain names) into [{sku, qty}, ...]."""
    rows = []
    for part in (current or '').split(','):
        part = part.strip()
        if not part:
            continue
        match = re.fullmatch(r'(.+?)\s*[×xX]\s*(\d+)\s*', part)
        if match:
            name, qty = match.group(1).strip(), int(match.group(2))
            if name and qty > 0:
                rows.append({'sku': name, 'qty': qty})
        else:
            rows.append({'sku': part, 'qty': 1})
    return rows


def interception_payload(r: UserInterception) -> dict:
    current = (r.current_sku or '').strip()
    current_sku_qtys = _parse_purchased_skus(current)
    return {
        'id': r.id,
        'baId': _ba_id(r.ambassador_id),
        'baName': r.ba_name,
        'storeId': r.store_id,
        'storeName': r.store_name,
        'name': r.name,
        'contact': r.contact,
        'cityArea': r.city_area,
        'previousBrand': r.previous_brand,
        'previousSku': r.previous_sku,
        'currentSku': current,
        'currentSkus': [row['sku'] for row in current_sku_qtys],
        'currentSkuQtys': current_sku_qtys,
        'feedback': r.feedback,
        'status': r.status,
        'createdAt': _iso(r.created_at),
    }


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def interceptions(request):
    """GET (Head Office / supervisor / the BA's own) · POST — a BA records a shopper they spoke with."""
    scope = _scope(request, allow_ba=True)
    if not scope:
        return _denied()
    if request.method == 'GET':
        qs = _ba_visible(UserInterception.objects.all(), scope)
        date_from, date_to = _date_param(request, 'date_from'), _date_param(request, 'date_to')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        limit = 5000 if (date_from or date_to) else 1000
        return Response({'results': [interception_payload(r) for r in qs[:limit]]})

    if not scope.ambassador:
        return _forbidden('Only a BA records an interception.')
    data = request.data
    text = {k: str(data.get(k) or '').strip() for k in (
        'name', 'contact', 'cityArea', 'previousBrand', 'previousSku', 'currentSku', 'feedback', 'storeName'
    )}
    # Prefer currentSkuQtys[{sku, qty}] (qty > 0 only); else currentSkus[]; else currentSku string.
    raw_qtys = data.get('currentSkuQtys') or data.get('purchasedSkus')
    if isinstance(raw_qtys, list):
        parts = []
        for row in raw_qtys:
            if not isinstance(row, dict):
                continue
            name = str(row.get('sku') or row.get('name') or '').strip()
            try:
                qty = int(row.get('qty') if row.get('qty') is not None else row.get('quantity') or 0)
            except (TypeError, ValueError):
                qty = 0
            if name and qty > 0:
                parts.append(f'{name} × {qty}')
        text['currentSku'] = ', '.join(parts)
    else:
        raw_skus = data.get('currentSkus')
        if isinstance(raw_skus, list):
            text['currentSku'] = ', '.join(str(s).strip() for s in raw_skus if str(s).strip())
    outcome = str(data.get('status') or '').strip()
    if outcome not in ('productive', 'trialist', 'non_productive'):
        # older app versions: a purchased SKU means productive
        outcome = 'productive' if text['currentSku'] else 'non_productive'
    if outcome != 'non_productive' and (not text['name'] or not text['contact']):
        return Response({'detail': 'Name and contact are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if outcome == 'non_productive':
        text['currentSku'] = ''  # nothing was bought
    store = Store.objects.filter(pk=data.get('storeId')).first() if data.get('storeId') else None
    store = store or _ba_store(scope.ambassador)
    from .ba_attendance_views import _today_shift_for
    from .shifts import business_today, work_datetime_on

    # Attribute the interception to the check-in / shift day (business day rolls at 05:00).
    work_shift = _today_shift_for(scope.ambassador)
    work_day = work_shift.date if work_shift and work_shift.checked_in_at else business_today()
    created_at = work_datetime_on(work_day, _when(data.get('createdAt')))
    record, created = UserInterception.objects.get_or_create(
        id=_client_id(data.get('id'), 'int'),
        defaults={
            'ambassador': scope.ambassador,
            'ba_name': str(data.get('baName') or scope.ambassador.name)[:120],
            'store': store,
            'store_name': (text['storeName'] or (store.name if store else ''))[:200],
            'name': text['name'][:120],
            'contact': text['contact'][:40],
            'city_area': text['cityArea'][:120],
            'previous_brand': text['previousBrand'][:120],
            'previous_sku': text['previousSku'][:120],
            'current_sku': text['currentSku'],
            'feedback': text['feedback'][:2000],
            'status': outcome,
            'created_at': created_at,
        },
    )
    return Response(interception_payload(record), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


# ─── Early check-outs ────────────────────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def early_checkouts(request):
    """BAs who checked out before shift end, with their reason. ?date_from&date_to (default today)."""
    scope = _scope(request)
    if not scope:
        return _denied()
    from .shifts import business_today

    today = business_today()
    date_to = _date_param(request, 'date_to') or today
    date_from = _date_param(request, 'date_from') or date_to
    qs = (
        ShiftAssignment.objects.filter(date__gte=date_from, date__lte=date_to, checked_out_at__isnull=False)
        .exclude(early_checkout_reason='')
        .select_related('store', 'ambassador')
        .order_by('-checked_out_at')
    )
    if scope.store_ids is not None:
        qs = qs.filter(store_id__in=scope.store_ids)
    return Response(
        {
            'results': [
                {
                    'id': f'early-{r.id}',
                    'baId': _ba_id(r.ambassador_id),
                    'baName': r.ambassador.name if r.ambassador_id else '',
                    'storeId': r.store_id,
                    'storeName': r.store.name,
                    'reason': r.early_checkout_reason,
                    'at': _iso(r.checked_out_at),
                }
                for r in qs
            ]
        }
    )


# ─── KPI / incentive settings ────────────────────────────────────────────────


@api_view(['GET', 'PUT'])
@permission_classes([AllowAny])
def kpi_config(request):
    """GET the incentive KPI settings (anyone in the app) · PUT — Head Office saves them."""
    cfg = KpiConfig.get_solo()
    if request.method == 'PUT':
        if not _is_head_office(request):
            return _denied()
        if not scope_for(request.user).is_all:
            return _forbidden('Incentive settings apply to every city; ask Head Office to change them.')
        cfg.config = KpiConfig.normalize(request.data)
        cfg.updated_by = request.user
        cfg.save()
    return Response(KpiConfig.normalize(cfg.config))


# ─── The BA's stores ─────────────────────────────────────────────────────────


def _ba_store_ids(ambassador) -> set[int]:
    """The stores a BA works at: their monthly shifts and their deployment."""
    ids = set(MonthlyShift.objects.filter(ambassador=ambassador).values_list('store_id', flat=True))
    if ambassador.store_id:
        ids.add(ambassador.store_id)
    return ids


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_stores(request):
    """GET ?token= — the stores a BA works at (their monthly shifts and deployment), for their forms."""
    ambassador = _ambassador_from_token(request.query_params.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    stores = Store.objects.filter(id__in=_ba_store_ids(ambassador)).order_by('name')
    return Response(
        {
            'current_store_id': (_ba_store(ambassador).id if _ba_store(ambassador) else None),
            'results': StoreSerializer(stores, many=True, context={'request': request}).data,
        }
    )


def _competitor_config_json(row):
    return {
        'id': row.id,
        'key': row.key,
        'label': row.label,
        'fieldType': row.field_type,
        'options': row.options,
        'scope': row.scope,
        'city': row.city or '',
        'storeId': row.store_id,
        'active': row.is_active,
    }


@api_view(['GET', 'PUT'])
@permission_classes([AllowAny])
def competitor_fields(request):
    """Manage competitor fields (office) and resolve the BA's active fields at checkout."""
    scope = _scope(request, allow_ba=True)
    if scope is None:
        return _denied()
    if request.method == 'GET':
        qs = CompetitorFieldConfig.objects.filter(is_active=True).select_related('store')
        if scope.ambassador:
            store = _ba_store(scope.ambassador)
            city = store.city if store else scope.ambassador.city
            store_rows = list(qs.filter(scope='STORE', store=store)) if store else []
            city_rows = list(qs.filter(scope='CITY', city__iexact=city)) if city else []
            rows = store_rows or city_rows or list(qs.filter(scope='ALL'))
            return Response({'results': [_competitor_config_json(row) for row in rows]})
        elif scope.supervisor:
            store_rows = list(qs.filter(scope='STORE', store_id__in=scope.store_ids or []))
            city_rows = list(qs.filter(scope='CITY', city__iexact=scope.supervisor.city))
            rows = store_rows or city_rows or list(qs.filter(scope='ALL'))
            return Response({'results': [_competitor_config_json(row) for row in rows]})
        elif not scope.city.is_all:
            store_rows = list(qs.filter(scope='STORE', store_id__in=scope.city.store_ids))
            city_rows = list(qs.filter(scope='CITY', city__iexact=scope.city.city))
            rows = store_rows or city_rows or list(qs.filter(scope='ALL'))
            return Response({'results': [_competitor_config_json(row) for row in rows]})
        return Response({'results': [_competitor_config_json(row) for row in qs]})

    # Only Head Office or supervisor sessions can change the form.
    if not scope.head_office and not scope.supervisor:
        return _forbidden()
    data = request.data
    field_rows = data.get('fields', [])
    target_scope = str(data.get('scope') or 'ALL').upper()
    city = str(data.get('city') or '').strip()[:100]
    store_id = data.get('storeId')
    if target_scope not in {'ALL', 'CITY', 'STORE'} or not isinstance(field_rows, list):
        return Response({'detail': 'Choose All, City or Store and add valid fields.'}, status=status.HTTP_400_BAD_REQUEST)
    store = Store.objects.filter(pk=store_id).first() if store_id else None
    if target_scope == 'CITY' and not city:
        return Response({'detail': 'Choose a city.'}, status=status.HTTP_400_BAD_REQUEST)
    if target_scope == 'STORE' and not store:
        return Response({'detail': 'Choose a store.'}, status=status.HTTP_400_BAD_REQUEST)
    if scope.supervisor and (target_scope == 'ALL' or (target_scope == 'CITY' and city.casefold() != scope.supervisor.city.casefold()) or
                             (target_scope == 'STORE' and store.id not in (scope.store_ids or set()))):
        return _forbidden('You can only configure stores in your assigned area.')
    if scope.head_office and not scope.city.is_all:
        if target_scope == 'ALL' or (target_scope == 'CITY' and city.casefold() != scope.city.city.casefold()) or \
                (target_scope == 'STORE' and not _stores_allowed(scope.city, [store.id] if store else [])):
            return _forbidden('You can only configure fields in your assigned city.')
    normalized = []
    for index, field in enumerate(field_rows[:50]):
        label = str(field.get('label') or '').strip()[:200]
        field_type = str(field.get('fieldType') or 'text').lower()
        if not label or field_type not in {'text', 'number'}:
            return Response({'detail': 'Each field needs a brand name and a text or number type.'}, status=status.HTTP_400_BAD_REQUEST)
        normalized.append((str(field.get('key') or secrets.token_hex(12)), label, field_type))
    with transaction.atomic():
        existing = CompetitorFieldConfig.objects.filter(scope=target_scope)
        if target_scope == 'CITY': existing = existing.filter(city__iexact=city)
        elif target_scope == 'STORE': existing = existing.filter(store=store)
        existing.delete()
        rows = [CompetitorFieldConfig(key=key, label=label, field_type=kind, scope=target_scope,
                   city=city if target_scope == 'CITY' else None, store=store if target_scope == 'STORE' else None,
                   created_by=request.user if _is_head_office(request) else None) for key, label, kind in normalized]
        CompetitorFieldConfig.objects.bulk_create(rows)
    return Response({'results': [_competitor_config_json(row) for row in rows]})


# ─── Shopper session ─────────────────────────────────────────────────────────


@api_view(['POST'])
@permission_classes([AllowAny])
def shopper_session(request):
    """
    POST {store (QR slug) or storeId, name, phone, gender, age, currentBrand, reasons[], consent}
    Saves what the shopper entered in the survey. Returns {id} for the feedback step.
    """
    data = request.data
    store = None
    if data.get('store'):
        store = Store.objects.filter(qr_slug=str(data['store'])).first()
    if not store and data.get('storeId'):
        store = Store.objects.filter(pk=data.get('storeId')).first()
    if not store:
        return Response({'detail': 'Scan the store QR code to start.'}, status=status.HTTP_400_BAD_REQUEST)
    if not data.get('consent'):
        return Response({'detail': 'Consent is required to save your answers.'}, status=status.HTTP_400_BAD_REQUEST)
    name = str(data.get('name') or '').strip()[:120]
    phone = str(data.get('phone') or '').strip()[:30]
    current_brand = str(data.get('currentBrand') or '').strip()[:120]
    reasons = [str(r).strip()[:80] for r in (data.get('reasons') or []) if str(r).strip()][:10]
    if not name or not phone or not current_brand:
        return Response({'detail': 'Name, number and current tea are required.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        age = int(data.get('age'))
        if not 5 <= age <= 120:
            raise ValueError
    except (TypeError, ValueError):
        return Response({'detail': 'Enter a valid age.'}, status=status.HTTP_400_BAD_REQUEST)

    # Keep campaign insights working: the current tea also answers survey question 1 ("Which tea…").
    answers = {}
    first = (
        SurveyQuestion.objects.filter(is_active=True, order=1)
        .filter(Q(store=store) | Q(store__isnull=True))
        .order_by('-store_id')
        .first()
    )
    if first:
        answers[str(first.id)] = current_brand
    consumer = Consumer.objects.create(
        store=store,
        name=name,
        phone=phone,
        consent=True,
        gender=str(data.get('gender') or '').strip()[:20],
        age=age,
        current_brand=current_brand,
        reasons=reasons,
        answers=answers,
    )
    return Response({'id': consumer.id, 'store': store.name}, status=status.HTTP_201_CREATED)


# ─── Training modules for the BA app ─────────────────────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def training_modules(request):
    """The active training video and its questions, in the app's TrainingModule shape."""
    from pathlib import PurePath

    from .ba_training_views import active_training_video

    video = active_training_video()
    if not video or not video.file:
        return Response({'results': []})
    questions = video.normalized_questions()
    name = video.original_name or 'Training video'
    return Response(
        {
            'results': [
                {
                    'id': f'tv-{video.id}',
                    'title': PurePath(name).stem.replace('_', ' ').replace('-', ' ').strip() or 'Training video',
                    'description': next((q.get('description', '') for q in questions if q.get('description')), ''),
                    'videoName': name,
                    'videoUrl': '/api/ba/training/video/',
                    'questions': [
                        {'id': str(q.get('id') or f'q{i + 1}'), 'prompt': q.get('question', '')}
                        for i, q in enumerate(questions)
                        if q.get('question')
                    ],
                    'createdAt': _iso(video.created_at),
                }
            ]
        }
    )


# ─── The BA's own summary (Rewards page, Home goals) ────────────────────────


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_me(request):
    """GET ?token= : rank, points, target, days worked, rating, today's interceptions and goals."""
    import math

    from .intelligence import build_ba_leaderboard
    from .models import AmbassadorMonthTarget
    from .target_sheet import report_skus_for_city
    from .views import _target_payload

    ambassador = _ambassador_from_token(request.query_params.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    from .ba_attendance_views import _today_shift_for
    from .shifts import business_today

    today = business_today()
    month = today.strftime('%Y-%m')
    week_start = today - timedelta(days=today.weekday())

    today_shift = _today_shift_for(ambassador)
    report_owner = (
        Ambassador.objects.filter(pk=today_shift.report_owner_id).first()
        if today_shift and today_shift.report_owner_id
        else ambassador
    )
    store = today_shift.store if today_shift else _ba_store(ambassador)

    board = build_ba_leaderboard()['results']
    mine = next((row for row in board if row['id'] == ambassador.id), None)

    target = AmbassadorMonthTarget.objects.filter(ambassador=report_owner, month=month).select_related('store').first()
    days_worked = (
        ShiftAssignment.objects.filter(
            ambassador=ambassador, date__year=today.year, date__month=today.month, checked_in_at__isnull=False
        )
        .values('date')
        .distinct()
        .count()
    )

    # Rating: shopper feedback (1-5) at the stores this BA works at, this month.
    store_ids = set(MonthlyShift.objects.filter(ambassador=ambassador, month=month).values_list('store_id', flat=True))
    if ambassador.store_id:
        store_ids.add(ambassador.store_id)
    ratings = list(
        Consumer.objects.filter(
            store_id__in=store_ids, feedback_rating__isnull=False, created_at__date__gte=today.replace(day=1)
        ).values_list('feedback_rating', flat=True)
    )

    mine_qs = UserInterception.objects.filter(ambassador=ambassador)
    today_rows = list(mine_qs.filter(created_at__date=today).only('status', 'current_sku'))
    week_sessions = mine_qs.filter(created_at__date__gte=week_start).count()

    def _is_productive(row) -> bool:
        outcome = (row.status or '').strip() or (
            'productive' if (row.current_sku or '').strip() else 'non_productive'
        )
        return outcome == 'productive'

    # Conversion = productive UserInterceptions ÷ total UserInterceptions for this BA × 100.
    total_calls = mine_qs.count()
    if total_calls:
        productive_calls = (
            mine_qs.filter(status='productive').count()
            + mine_qs.filter(status='').exclude(current_sku='').count()
            + mine_qs.filter(status__isnull=True).exclude(current_sku='').count()
        )
        conversion = round((productive_calls / total_calls) * 100, 1)
    else:
        conversion = 0.0

    productive_today = sum(1 for r in today_rows if _is_productive(r))
    week_goal = KpiConfig.normalize(KpiConfig.get_solo().config)['sessionTarget']

    return Response(
        {
            'name': ambassador.name,
            'baCode': ambassador.ba_code,
            'reportOwner': {
                'id': report_owner.id,
                'name': report_owner.name,
                'baCode': report_owner.ba_code,
                'isCovering': report_owner.id != ambassador.id,
            },
            'status': ambassador.status,
            'certified': ambassador.status in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED),
            'city': ambassador.city or (store.city if store else ''),
            'storeName': store.name if store else '',
            'rank': mine['rank'] if mine else None,
            'rankedOutOf': len(board),
            'points': mine['points'] if mine else 0,
            'conversion': conversion,
            'weekSessions': week_sessions,
            'monthTarget': _target_payload(target) if target else None,
            # Use the report owner’s city list when the report owner has no target SKUs.
            'reportSkus': report_skus_for_city(report_owner.city or (store.city if store else '')),
            'daysWorked': days_worked,
            'rating': round(sum(ratings) / len(ratings), 1) if ratings else None,
            'ratingCount': len(ratings),
            'today': {
                'interceptions': len(today_rows),
                'productive': productive_today,
                # Kept for older clients; same as productive under the new conversion rule.
                'switched': productive_today,
                'dailyGoal': max(1, math.ceil(week_goal / 6)),
            },
        }
    )


# ─── Retraining answers ──────────────────────────────────────────────────────


def practice_payload(p) -> dict:
    return {
        'id': p.id,
        'baId': _ba_id(p.ambassador_id),
        'baName': p.ambassador.name,
        'kind': p.kind,
        'title': p.title,
        'question': p.question,
        'answer': p.answer,
        'createdAt': _iso(p.created_at),
    }


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def training_practice(request):
    """
    POST {token, kind: video|scenario, title, question, answer}: the BA saves a retraining answer.
    GET: Head Office (all or ?ambassador=<id>), a supervisor (their stores' BAs), or the BA (their own).
    """
    from .models import TrainingPractice

    scope = _scope(request, allow_ba=True)
    if not scope:
        return _denied()
    if request.method == 'POST':
        if not scope.ambassador:
            return _forbidden('Only a BA records a training answer.')
        kind = request.data.get('kind')
        question = str(request.data.get('question') or '').strip()
        answer = str(request.data.get('answer') or '').strip()
        if kind not in TrainingPractice.Kind.values or not question or not answer:
            return Response({'detail': 'Give the question and your answer.'}, status=status.HTTP_400_BAD_REQUEST)
        practice = TrainingPractice.objects.create(
            ambassador=scope.ambassador,
            kind=kind,
            title=str(request.data.get('title') or '').strip()[:200],
            question=question[:2000],
            answer=answer[:5000],
        )
        return Response(practice_payload(practice), status=status.HTTP_201_CREATED)

    qs = TrainingPractice.objects.select_related('ambassador')
    if scope.ambassador:
        qs = qs.filter(ambassador=scope.ambassador)
    elif scope.supervisor is not None:
        qs = qs.filter(
            Q(ambassador__store_id__in=scope.store_ids) | Q(ambassador__monthly_shifts__store_id__in=scope.store_ids)
        ).distinct()
    elif not scope.city.is_all:
        qs = qs.filter(ambassador_id__in=scope.city.ambassador_ids)
    ambassador = request.query_params.get('ambassador')
    if ambassador and not scope.ambassador:
        qs = qs.filter(ambassador_id=ambassador)
    return Response({'results': [practice_payload(p) for p in qs[:500]]})


@api_view(['GET'])
@permission_classes([AllowAny])
def supervisor_password(request, pk):
    """Head Office: the supervisor's current password (null if it has to be set again)."""
    if not _is_head_office(request):
        return _denied()
    sup = get_object_or_404(_visible_supervisors(scope_for(request.user)), pk=pk)
    return Response({'password': sup.reveal_password(), 'hasLogin': bool(sup.password)})

