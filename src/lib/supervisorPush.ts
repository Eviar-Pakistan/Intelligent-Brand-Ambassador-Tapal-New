export async function enableSupervisorPush(supervisorId: string) {
  if (!('Notification' in window)) {
    throw new Error('This browser does not support notifications.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Allow notifications to sign in. Supervisors are alerted when a BA checks in or out.')
  }

  const config = await fetch('/firebase-config.json')
    .then((response) => response.json())
    .catch(() => null)
  if (!config?.apiKey || !config?.vapidKey) return

  const { getApps, initializeApp } = await import('firebase/app')
  const { getMessaging, getToken, onMessage } = await import('firebase/messaging')
  const { vapidKey, ...firebaseConfig } = config as { vapidKey: string; apiKey: string }
  const app = getApps()[0] ?? initializeApp(firebaseConfig)
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const messaging = getMessaging(app)
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
  if (!token) return
  await fetch('/api/push/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supervisorId, token }),
  })
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? 'Supervisor alert'
    const body = payload.notification?.body ?? ''
    new Notification(title, { body })
  })
}
