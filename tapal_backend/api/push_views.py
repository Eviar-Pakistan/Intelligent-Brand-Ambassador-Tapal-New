"""Supervisor web-push (FCM). Same paths the Node pushApi.mjs used to serve."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import SupervisorPushEvent, SupervisorPushToken

logger = logging.getLogger(__name__)

_messaging = None
_messaging_tried = False


def firebase_web_config() -> dict:
    return {
        'apiKey': getattr(settings, 'FIREBASE_API_KEY', '') or '',
        'authDomain': getattr(settings, 'FIREBASE_AUTH_DOMAIN', '') or '',
        'projectId': getattr(settings, 'FIREBASE_PROJECT_ID', '') or '',
        'storageBucket': getattr(settings, 'FIREBASE_STORAGE_BUCKET', '') or '',
        'messagingSenderId': getattr(settings, 'FIREBASE_MESSAGING_SENDER_ID', '') or '',
        'appId': getattr(settings, 'FIREBASE_APP_ID', '') or '',
        'vapidKey': getattr(settings, 'FIREBASE_VAPID_KEY', '') or '',
    }


def service_worker_source(config: dict) -> str:
    web = {k: v for k, v in config.items() if k != 'vapidKey'}
    return (
        "importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js')\n"
        "importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js')\n"
        f'firebase.initializeApp({json.dumps(web)})\n'
        'const messaging = firebase.messaging()\n'
        'messaging.onBackgroundMessage((payload) => {\n'
        "  const title = payload.notification?.title || 'Supervisor alert'\n"
        "  const body = payload.notification?.body || ''\n"
        '  self.registration.showNotification(title, { body })\n'
        '})\n'
        "self.addEventListener('notificationclick', (event) => {\n"
        '  event.notification.close()\n'
        "  event.waitUntil(self.clients.openWindow('/supervisor'))\n"
        '})\n'
    )


def _fcm_messaging():
    # Only a successful start is remembered: if the service account is added later, the next send
    # picks it up without restarting the server.
    global _messaging, _messaging_tried
    if _messaging is not None:
        return _messaging
    _messaging_tried = True
    path = Path(getattr(settings, 'FIREBASE_SERVICE_ACCOUNT_PATH', '') or '')
    if not path.is_file():
        logger.warning('Firebase service account missing at %s', path)
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, messaging
    except ImportError:
        logger.warning('firebase-admin is not installed')
        return None
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(str(path)))
    _messaging = messaging
    return _messaging


def _trim_inbox(supervisor_id: str, keep: int = 80) -> None:
    ids = list(
        SupervisorPushEvent.objects.filter(supervisor_id=supervisor_id)
        .order_by('-created_at')
        .values_list('pk', flat=True)[keep:]
    )
    if ids:
        SupervisorPushEvent.objects.filter(pk__in=ids).delete()


@api_view(['GET'])
@permission_classes([AllowAny])
def firebase_config(request):
    return Response(firebase_web_config())


@api_view(['GET'])
@permission_classes([AllowAny])
def firebase_messaging_sw(request):
    body = service_worker_source(firebase_web_config())
    response = HttpResponse(body, content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    return response


def _supervisor_id(request) -> str | None:
    """The signed-in supervisor (X-Supervisor-Token)."""
    from .portal_views import _supervisor_from_header

    sup = _supervisor_from_header(request)
    return sup.id if sup else None


def send_push(supervisor_id: str, title: str, body: str, event_id: str | None = None) -> dict:
    """
    Record the alert in the supervisor's inbox and send it to every browser/phone they enabled
    notifications on. Runs on the server; invalid (expired) browser tokens are removed.
    """
    event_id = event_id or f'push-{int(time.time() * 1000)}'
    SupervisorPushEvent.objects.update_or_create(
        event_id=event_id, defaults={'supervisor_id': supervisor_id, 'title': title, 'body': body}
    )
    _trim_inbox(supervisor_id)

    errors: list[str] = []
    messaging = _fcm_messaging()
    tokens = list(SupervisorPushToken.objects.filter(supervisor_id=supervisor_id).values_list('token', flat=True))
    if messaging is None:
        errors.append('Firebase Admin is not initialized (service account file missing)')
    elif not tokens:
        errors.append('This supervisor has not enabled notifications on any device yet')
    else:
        link = (getattr(settings, 'FRONTEND_BASE_URL', '') or 'https://tapalbaecosystem.com').rstrip('/')
        if not link.startswith('https://'):
            link = 'https://tapalbaecosystem.com'
        for token in tokens:
            try:
                messaging.send(
                    messaging.Message(
                        token=token,
                        notification=messaging.Notification(title=title, body=body),
                        webpush=messaging.WebpushConfig(
                            fcm_options=messaging.WebpushFCMOptions(link=f'{link}/supervisor'),
                        ),
                    )
                )
            except Exception as exc:  # noqa: BLE001
                name = type(exc).__name__
                if name in ('UnregisteredError', 'SenderIdMismatchError') or 'not a valid FCM registration' in str(exc):
                    SupervisorPushToken.objects.filter(token=token).delete()
                errors.append(str(exc) or 'FCM send failed')
                logger.exception('FCM send failed for supervisor %s', supervisor_id)
    if errors:
        logger.warning('[push] %s', '; '.join(errors))
    return {'ok': not errors, 'id': event_id, 'errors': errors, 'sent_to': len(tokens) if messaging else 0}


def send_push_later(supervisor_id: str, title: str, body: str, event_id: str | None = None) -> None:
    """Send in the background so a BA's check-in is not slowed down by Firebase."""
    import threading

    from django.db import close_old_connections

    def run():
        try:
            send_push(supervisor_id, title, body, event_id)
        except Exception:  # noqa: BLE001
            logger.exception('push to supervisor %s failed', supervisor_id)
        finally:
            close_old_connections()

    threading.Thread(target=run, daemon=True).start()


@api_view(['POST'])
@permission_classes([AllowAny])
def push_register(request):
    """The signed-in supervisor's browser saves its notification token. POST {token}."""
    supervisor_id = _supervisor_id(request)
    token = str(request.data.get('token') or '').strip()
    if not supervisor_id:
        return Response({'ok': False, 'detail': 'Sign in as a supervisor to enable notifications.'}, status=401)
    if not token:
        return Response({'ok': False, 'detail': 'Missing notification token.'}, status=400)
    SupervisorPushToken.objects.update_or_create(supervisor_id=supervisor_id, token=token, defaults={})
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([AllowAny])
def push_send(request):
    """Head Office: send a test / manual alert. POST {supervisorId, title, body}."""
    if not (request.user and request.user.is_authenticated):
        return Response({'ok': False, 'detail': 'Head Office only.'}, status=401)
    supervisor_id = str(request.data.get('supervisorId') or '').strip()
    title = str(request.data.get('title') or '').strip()
    if not supervisor_id or not title:
        return Response({'ok': False}, status=400)
    return Response(send_push(supervisor_id, title, str(request.data.get('body') or ''), request.data.get('id')))


@api_view(['GET'])
@permission_classes([AllowAny])
def push_inbox(request):
    """The signed-in supervisor's recent alerts."""
    supervisor_id = _supervisor_id(request)
    if not supervisor_id:
        return Response({'events': []}, status=401)
    events = [
        {
            'id': row.event_id,
            'supervisorId': row.supervisor_id,
            'title': row.title,
            'body': row.body,
            'createdAt': row.created_at.isoformat(),
        }
        for row in SupervisorPushEvent.objects.filter(supervisor_id=supervisor_id).order_by('-created_at')[:80]
    ]
    return Response({'events': events})
