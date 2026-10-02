"""BA invite-token endpoints for today's shift check-in / check-out."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Ambassador, AmbassadorComplaint, MonthlyShift, ShiftAssignment, Store
from .portal_views import notify_supervisor
from .shifts import ensure_daily_rows


def _ambassador_from_token(token: str | None) -> Ambassador | None:
    token = (token or '').strip()
    if not token:
        return None
    return Ambassador.objects.filter(invite_token=token, is_active=True).first()


def _server_now() -> datetime:
    """The server's clock. Whether a check-out is early is decided on this, never on the BA's phone."""
    return timezone.now()


def _shift_end_at(shift: ShiftAssignment) -> datetime | None:
    """When the shift ends, as an exact moment in the server's time zone (Asia/Karachi). A shift that ends past midnight ends the next day."""
    if not shift.end_time:
        return None
    end = datetime.combine(shift.date, shift.end_time)
    if shift.start_time and shift.end_time <= shift.start_time:
        end += timedelta(days=1)
    return timezone.make_aware(end)


def _past_shift_end(shift: ShiftAssignment) -> bool:
    end_at = _shift_end_at(shift)
    return end_at is None or _server_now() >= end_at


def _today_shift_for(ambassador: Ambassador) -> ShiftAssignment | None:
    today = timezone.localdate()
    ensure_daily_rows(today, ambassador)
    qs = (
        ShiftAssignment.objects.filter(
            ambassador=ambassador,
            date=today,
            status__in=(
                ShiftAssignment.Status.SCHEDULED,
                ShiftAssignment.Status.CONFLICT,
            ),
        )
        .select_related('store', 'ambassador')
        .order_by('shift_label', 'id')
    )
    # One check-in and one check-out per day: the shift the BA is on, else the one they already
    # finished today (so a second shift cannot be started), else the earliest not started.
    active = qs.filter(checked_in_at__isnull=False, checked_out_at__isnull=True).first()
    if active:
        return active
    done = qs.filter(checked_in_at__isnull=False, checked_out_at__isnull=False).first()
    if done:
        return done
    pending = qs.filter(checked_out_at__isnull=True).first()
    if pending:
        return pending
    return qs.first()


def _upcoming_rows(ambassador: Ambassador) -> list[dict]:
    """This month's and later monthly shifts."""
    this_month = timezone.localdate().strftime('%Y-%m')
    upcoming = (
        MonthlyShift.objects.filter(ambassador=ambassador, month__gte=this_month)
        .select_related('store')
        .order_by('month', 'start_time', 'id')[:12]
    )
    return [
        {
            'id': str(s.id),
            'month': s.month,
            'shift': s.shift_label,
            'startTime': s.start_time.strftime('%H:%M'),
            'endTime': s.end_time.strftime('%H:%M'),
            'storeId': s.store_id,
            'storeName': s.store.name,
            'city': s.store.city,
            'storeLabel': f'#{s.store_id} {s.store.name}',
            'isThisMonth': s.month == this_month,
        }
        for s in upcoming
    ]


def serialize_ba_shift(shift: ShiftAssignment | None, ambassador: Ambassador) -> dict:
    initials = ''.join(p[0] for p in (ambassador.name or 'BA').split() if p)[:2].upper() or 'BA'
    upcoming_rows = _upcoming_rows(ambassador)
    server_now = _server_now().isoformat()
    if not shift:
        store = ambassador.store
        return {
            'serverNow': server_now,
            'shift': None,
            'has_shift': False,
            'message': (
                'No shift scheduled for today.'
                if not upcoming_rows
                else 'No shift today — see upcoming shifts below.'
            ),
            'ambassador': {
                'id': ambassador.id,
                'name': ambassador.name,
                'initials': initials,
                'status': ambassador.status,
                'store_id': store.id if store else None,
                'store_name': store.name if store else None,
            },
            'upcoming': upcoming_rows,
        }

    store = shift.store
    end_at = _shift_end_at(shift)
    return {
        'serverNow': server_now,
        'has_shift': True,
        'message': None,
        'ambassador': {
            'id': ambassador.id,
            'name': ambassador.name,
            'initials': initials,
            'status': ambassador.status,
            'store_id': store.id,
            'store_name': store.name,
        },
        'shift': {
            'id': str(shift.id),
            'date': shift.date.isoformat(),
            'day': shift.day_key,
            'shift': shift.shift_label,
            'startTime': shift.start_time.strftime('%H:%M') if shift.start_time else None,
            'endTime': shift.end_time.strftime('%H:%M') if shift.end_time else None,
            'endAt': end_at.isoformat() if end_at else None,
            'pastShiftEnd': _past_shift_end(shift),
            'storeId': store.id,
            'storeName': store.name,
            'city': store.city,
            'storeLabel': f'#{store.id} {store.name}, {store.city}'.strip(', '),
            'supervisorId': store.supervisor_id,
            'peakRecommended': shift.peak_recommended,
            'status': shift.status,
            'checkedIn': bool(shift.checked_in_at),
            'checkedOut': bool(shift.checked_out_at),
            'isLive': shift.is_checked_in,
            'checkedInAt': shift.checked_in_at.isoformat() if shift.checked_in_at else None,
            'checkedOutAt': shift.checked_out_at.isoformat() if shift.checked_out_at else None,
            'reportSubmitted': bool(shift.report_submitted_at),
            'checkInLat': shift.check_in_lat,
            'checkInLng': shift.check_in_lng,
            'storeLat': store.latitude,
            'storeLng': store.longitude,
        },
        'upcoming': upcoming_rows,
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_today_shift(request):
    """GET /api/ba/today-shift/?token=…"""
    ambassador = _ambassador_from_token(request.query_params.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    shift = _today_shift_for(ambassador)
    return Response(serialize_ba_shift(shift, ambassador))


@api_view(['POST'])
@permission_classes([AllowAny])
def ba_submit_complaint(request):
    """Submit a store complaint using the BA's invite token."""
    ambassador = _ambassador_from_token(request.data.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    try:
        store_id = int(request.data.get('store_id'))
    except (TypeError, ValueError):
        return Response({'detail': 'A store is required.'}, status=status.HTTP_400_BAD_REQUEST)
    complaint = str(request.data.get('complaint') or '').strip()
    if not complaint:
        return Response({'detail': 'Please describe the complaint.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(complaint) > 2000:
        return Response({'detail': 'Complaint must be 2,000 characters or fewer.'}, status=status.HTTP_400_BAD_REQUEST)

    assigned_store_ids = set(
        ShiftAssignment.objects.filter(ambassador=ambassador).values_list('store_id', flat=True)
    ) | set(MonthlyShift.objects.filter(ambassador=ambassador).values_list('store_id', flat=True))
    if ambassador.store_id:
        assigned_store_ids.add(ambassador.store_id)
    if store_id not in assigned_store_ids:
        return Response({'detail': 'You can submit complaints only for your assigned stores.'}, status=status.HTTP_403_FORBIDDEN)
    store = Store.objects.filter(pk=store_id).first()
    if not store:
        return Response({'detail': 'Store not found.'}, status=status.HTTP_404_NOT_FOUND)
    complaint_row = AmbassadorComplaint.objects.create(
        ambassador=ambassador, store=store, complaint=complaint,
    )
    return Response({'id': complaint_row.id, 'status': complaint_row.status}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
def ba_check_in(request):
    """
    POST /api/ba/check-in/
    Body: { token, latitude, longitude, accuracy?, selfie? }
    The BA's location is required: no check-in is recorded without it.
    """
    ambassador = _ambassador_from_token(request.data.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)

    shift = _today_shift_for(ambassador)
    if not shift:
        return Response(
            {'detail': 'No shift scheduled for today.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if shift.checked_out_at:
        return Response(
            {'detail': 'You have already checked in and out today. Check-in opens again tomorrow.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if shift.checked_in_at:
        return Response(serialize_ba_shift(shift, ambassador))

    lat, lng, accuracy = _location(request.data)
    if lat is None:
        return Response({'detail': LOCATION_REQUIRED.format('check in')}, status=status.HTTP_400_BAD_REQUEST)

    shift.checked_in_at = timezone.now()
    shift.check_in_lat, shift.check_in_lng, shift.check_in_accuracy_m = lat, lng, accuracy
    from .portal_views import _image_from_data_url

    selfie = _image_from_data_url(request.data.get('selfie'), f'checkin-{shift.id}-{ambassador.id}')
    if selfie:
        shift.check_in_photo.save(selfie.name, selfie, save=False)
    shift.save(
        update_fields=[
            'checked_in_at',
            'check_in_lat',
            'check_in_lng',
            'check_in_accuracy_m',
            'check_in_photo',
            'updated_at',
        ]
    )
    notify_supervisor(shift, 'check-in')
    return Response(serialize_ba_shift(shift, ambassador))


LOCATION_REQUIRED = 'Your location is required to {}. Turn on location (GPS), allow it for this app, then try again.'


def _location(data) -> tuple[float | None, float | None, float | None]:
    """(latitude, longitude, accuracy in metres) sent by the BA's phone; None where missing or invalid."""

    def num(key, low, high):
        try:
            value = float(data.get(key))
        except (TypeError, ValueError):
            return None
        return value if low <= value <= high else None

    lat, lng = num('latitude', -90, 90), num('longitude', -180, 180)
    if lat is None or lng is None:
        return None, None, None
    return lat, lng, num('accuracy', 0, 100000)


REPORT_PARTS = ('stock', 'sales', 'otherBrands')


def _clean_report(raw) -> dict | None:
    """The checkout form: {stock: {...}, sales: {...}, otherBrands: [...]}. None when nothing was filled."""
    if not isinstance(raw, dict):
        return None
    report = {
        'stock': raw.get('stock') if isinstance(raw.get('stock'), dict) else {},
        'sales': raw.get('sales') if isinstance(raw.get('sales'), dict) else {},
        'otherBrands': raw.get('otherBrands') if isinstance(raw.get('otherBrands'), list) else [],
    }
    if not any(report[part] for part in REPORT_PARTS):
        return None
    return report


@api_view(['POST'])
@permission_classes([AllowAny])
def ba_check_out(request):
    """
    POST /api/ba/check-out/
    Body: { token, report: {stock, sales, otherBrands}, latitude, longitude, accuracy?, early_reason? }
    Check-out only counts once the report is submitted; that is what marks the BA Present.
    The BA's location is required: no check-out is recorded without it.
    Before the shift's end (server time) early_reason is required; after it, any early_reason is ignored.
    """
    ambassador = _ambassador_from_token(request.data.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)

    shift = _today_shift_for(ambassador)
    if not shift:
        return Response({'detail': 'No shift scheduled for today.'}, status=status.HTTP_400_BAD_REQUEST)
    if not shift.checked_in_at:
        return Response({'detail': 'Check in before ending the shift.'}, status=status.HTTP_400_BAD_REQUEST)
    if shift.checked_out_at and shift.report_submitted_at:
        return Response(serialize_ba_shift(shift, ambassador))

    report = _clean_report(request.data.get('report'))
    if report is None:
        return Response(
            {'detail': 'Submit your stock, sales and competitor report to check out.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    lat, lng, accuracy = _location(request.data)
    if lat is None:
        return Response({'detail': LOCATION_REQUIRED.format('check out')}, status=status.HTTP_400_BAD_REQUEST)

    # Early or not is decided here, on the server's clock. A reason is required when early and dropped when not.
    early = not _past_shift_end(shift)
    reason = str(request.data.get('early_reason') or '').strip()[:1000]
    if early and not reason:
        ends = shift.end_time.strftime('%I:%M %p').lstrip('0')
        return Response(
            {'detail': f'Your shift ends at {ends}. Give a reason to check out early.', 'early': True},
            status=status.HTTP_400_BAD_REQUEST,
        )

    now = timezone.now()
    shift.checkout_report = report
    shift.report_submitted_at = now
    shift.checked_out_at = now
    shift.early_checkout_reason = reason if early else ''
    shift.check_out_lat, shift.check_out_lng, shift.check_out_accuracy_m = lat, lng, accuracy
    shift.save(
        update_fields=[
            'checkout_report',
            'report_submitted_at',
            'checked_out_at',
            'early_checkout_reason',
            'check_out_lat',
            'check_out_lng',
            'check_out_accuracy_m',
            'updated_at',
        ]
    )
    notify_supervisor(shift, 'check-out')
    return Response(serialize_ba_shift(shift, ambassador))


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_leaderboard(request):
    """GET /api/ba/leaderboard/?token=… — invite-token BA view of rankings."""
    from .intelligence import build_ba_leaderboard

    ambassador = _ambassador_from_token(request.query_params.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    data = build_ba_leaderboard()
    data['me_id'] = ambassador.id
    return Response(data)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def ba_footfall(request):
    """
    GET ?token= : today's footfall at the BA's store.  POST {token, count}: the BA enters it.
    The store is where the BA works today (their shift), else where they are deployed.
    """
    from .portal_views import _ba_store
    from .store_live import record_footfall, reset_stale_footfall

    token = request.data.get('token') if request.method == 'POST' else request.query_params.get('token')
    ambassador = _ambassador_from_token(token)
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    store = _ba_store(ambassador)
    if not store:
        return Response({'detail': 'You have no store today.'}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'POST':
        try:
            count = int(request.data.get('count'))
            if count < 0 or count > 100000:
                raise ValueError
        except (TypeError, ValueError):
            return Response({'detail': 'Enter the number of shoppers who came in today.'}, status=status.HTTP_400_BAD_REQUEST)
        record_footfall(store, count, entered_by=f'{ambassador.name} ({ambassador.ba_code})')
    else:
        reset_stale_footfall()
        store.refresh_from_db(fields=['today_footfall', 'footfall_date'])
    return Response({'storeId': store.id, 'storeName': store.name, 'todayFootfall': store.today_footfall})

