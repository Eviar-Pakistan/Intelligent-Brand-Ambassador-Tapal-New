"""BA invite-token endpoints for today's shift check-in / check-out."""

from __future__ import annotations

from datetime import date

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Ambassador, AmbassadorComplaint, MonthlyShift, ShiftAssignment, Store
from .shifts import ensure_daily_rows


def _ambassador_from_token(token: str | None) -> Ambassador | None:
    token = (token or '').strip()
    if not token:
        return None
    return Ambassador.objects.filter(invite_token=token).first()


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
    # Prefer an active (checked-in, not out) shift, else earliest not checked out, else any
    active = qs.filter(checked_in_at__isnull=False, checked_out_at__isnull=True).first()
    if active:
        return active
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
    if not shift:
        store = ambassador.store
        return {
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
    return {
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
            'storeId': store.id,
            'storeName': store.name,
            'city': store.city,
            'storeLabel': f'#{store.id} {store.name}, {store.city}'.strip(', '),
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
    if ambassador.status not in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED):
        return Response(
            {'detail': 'Complete certification before checking in to shifts.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    shift = _today_shift_for(ambassador)
    return Response(serialize_ba_shift(shift, ambassador))


@api_view(['POST'])
@permission_classes([AllowAny])
def ba_submit_complaint(request):
    """Submit a store complaint using the BA's invite token."""
    ambassador = _ambassador_from_token(request.data.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    if ambassador.status not in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED):
        return Response({'detail': 'Complete certification before submitting a complaint.'}, status=status.HTTP_403_FORBIDDEN)
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
    Body: { token, latitude?, longitude?, accuracy? }
    """
    ambassador = _ambassador_from_token(request.data.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    if ambassador.status not in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED):
        return Response(
            {'detail': 'Complete certification before checking in.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    shift = _today_shift_for(ambassador)
    if not shift:
        return Response(
            {'detail': 'No shift scheduled for today.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if shift.checked_out_at:
        return Response(
            {'detail': 'This shift was already ended.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if shift.checked_in_at:
        return Response(serialize_ba_shift(shift, ambassador))

    lat = request.data.get('latitude')
    lng = request.data.get('longitude')
    accuracy = request.data.get('accuracy')

    def _f(v):
        if v is None or v == '':
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    shift.checked_in_at = timezone.now()
    shift.check_in_lat = _f(lat)
    shift.check_in_lng = _f(lng)
    shift.check_in_accuracy_m = _f(accuracy)
    shift.save(
        update_fields=[
            'checked_in_at',
            'check_in_lat',
            'check_in_lng',
            'check_in_accuracy_m',
            'updated_at',
        ]
    )
    return Response(serialize_ba_shift(shift, ambassador))


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
    POST /api/ba/check-out/  Body: { token, report: {stock, sales, otherBrands}, early_reason? }
    Check-out only counts once the report is submitted; that is what marks the BA Present.
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

    now = timezone.now()
    shift.checkout_report = report
    shift.report_submitted_at = now
    shift.checked_out_at = now
    shift.early_checkout_reason = str(request.data.get('early_reason') or '').strip()[:1000]
    shift.save(
        update_fields=[
            'checkout_report',
            'report_submitted_at',
            'checked_out_at',
            'early_checkout_reason',
            'updated_at',
        ]
    )
    return Response(serialize_ba_shift(shift, ambassador))


@api_view(['GET'])
@permission_classes([AllowAny])
def ba_leaderboard(request):
    """GET /api/ba/leaderboard/?token=… — invite-token BA view of rankings."""
    from .intelligence import build_ba_leaderboard

    ambassador = _ambassador_from_token(request.query_params.get('token'))
    if not ambassador:
        return Response({'detail': 'Invalid or missing invite token.'}, status=status.HTTP_404_NOT_FOUND)
    if ambassador.status not in (Ambassador.Status.CERTIFIED, Ambassador.Status.DEPLOYED):
        return Response(
            {'detail': 'Complete certification to view the leaderboard.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    data = build_ba_leaderboard()
    data['me_id'] = ambassador.id
    return Response(data)
