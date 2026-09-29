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
    global _messaging, _messaging_tried
    if _messaging_tried:
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


@api_view(['POST'])
@permission_classes([AllowAny])
def push_register(request):
    supervisor_id = str(request.data.get('supervisorId') or '').strip()
    token = str(request.data.get('token') or '').strip()
    if not supervisor_id or not token:
        return Response({'ok': False}, status=400)
    SupervisorPushToken.objects.update_or_create(
        supervisor_id=supervisor_id,
        token=token,
        defaults={},
    )
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([AllowAny])
def push_send(request):
    supervisor_id = str(request.data.get('supervisorId') or '').strip()
    title = str(request.data.get('title') or '').strip()
    body = str(request.data.get('body') or '')
    event_id = str(request.data.get('id') or '').strip() or f'push-{int(time.time() * 1000)}'
    if not supervisor_id or not title:
        return Response({'ok': False}, status=400)

    SupervisorPushEvent.objects.update_or_create(
        event_id=event_id,
        defaults={
            'supervisor_id': supervisor_id,
            'title': title,
            'body': body,
        },
    )
    _trim_inbox(supervisor_id)

    errors: list[str] = []
    messaging = _fcm_messaging()
    tokens = list(
        SupervisorPushToken.objects.filter(supervisor_id=supervisor_id).values_list('token', flat=True)
    )
    if messaging is None:
        errors.append('Firebase Admin is not initialized')
    elif not tokens:
        errors.append('No FCM token saved for this supervisor')
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
            except Exception as exc:  # noqa: BLE001 — report every FCM failure to the client
                errors.append(str(exc) or 'FCM send failed')
                logger.exception('FCM send failed for supervisor %s', supervisor_id)

    if errors:
        logger.error('[push] %s', '; '.join(errors))
    return Response({'ok': len(errors) == 0, 'id': event_id, 'errors': errors})


@api_view(['GET'])
@permission_classes([AllowAny])
def push_inbox(request):
    supervisor_id = str(request.query_params.get('supervisorId') or '').strip()
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
