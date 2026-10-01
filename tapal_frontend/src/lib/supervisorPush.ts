import { supervisorToken } from './serverApi'

/** 'granted' | 'denied' | 'default' (not asked yet) | 'unsupported'. */
export function supervisorPushPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported'
}

/**
 * Turns on phone alerts for the signed-in supervisor. Asks for permission (call it from a tap, e.g.
 * the bell), then registers this browser with the server so it receives a push on BA check-in / out.
 */
export async function enableSupervisorPush(supervisorId: string) {
  if (!('Notification' in window)) {
    throw new Error('This browser does not support notifications. On iPhone, add the site to the Home Screen first.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      'Notifications are blocked for this site. Allow them from the lock icon in the address bar → Notifications, then tap the bell again.',
    )
  }

  const config = await fetch('/firebase-config.json')
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
  if (!config?.apiKey || !config?.vapidKey) {
    throw new Error('Notification setup is missing. /firebase-config.json did not return the Firebase keys.')
  }

  const { getApps, initializeApp } = await import('firebase/app')
  const { getMessaging, getToken, onMessage } = await import('firebase/messaging')
  const { vapidKey, ...firebaseConfig } = config as { vapidKey: string; apiKey: string }
  const app = getApps()[0] ?? initializeApp(firebaseConfig)
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const messaging = getMessaging(app)
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
  if (!token) throw new Error('This browser did not receive a notification token.')
  // The server knows who this is from the supervisor's sign-in token.
  const saved = await fetch('/api/push/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Supervisor-Token': supervisorToken() ?? '' },
    body: JSON.stringify({ supervisorId, token }),
  })
  if (!saved.ok) throw new Error('The server did not save this browser for notifications.')
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? 'Supervisor alert'
    const body = payload.notification?.body ?? ''
    new Notification(title, { body })
  })
}
