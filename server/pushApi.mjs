import fs from 'node:fs'
import path from 'node:path'

function readEnv(root) {
  const env = { ...process.env }
  try {
    const text = fs.readFileSync(path.join(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (env[key] === undefined) env[key] = value
    }
  } catch {
    // production can supply the same names through the process environment
  }
  return env
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function serviceWorkerSource(config) {
  return `importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js')
firebase.initializeApp(${JSON.stringify(config)})
const messaging = firebase.messaging()
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Supervisor alert'
  const body = payload.notification?.body || ''
  self.registration.showNotification(title, { body })
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow('/supervisor'))
})
`
}

export function createPushRuntime(root = process.cwd()) {
  const env = readEnv(root)
  const file = path.join(root, 'data', 'supervisor-push.json')
  const serviceAccountPath = path.join(root, 'firebase-service-account.json')
  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  }
  const vapidKey = env.VITE_FIREBASE_VAPID_KEY ?? ''

  let messagingReady = null
  function messaging() {
    messagingReady ??= (async () => {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app')
      const { getMessaging } = await import('firebase-admin/messaging')
      if (!getApps().length && fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
        initializeApp({ credential: cert(serviceAccount) })
      }
      return getApps().length ? getMessaging() : null
    })()
    return messagingReady
  }

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      return {
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      }
    } catch {
      return { tokens: [], events: [] }
    }
  }

  function save(store) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(store))
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname.replace(/\/$/, '') || '/'

    if (pathname === '/firebase-messaging-sw.js' && req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/javascript')
      res.setHeader('Service-Worker-Allowed', '/')
      res.end(serviceWorkerSource(firebaseConfig))
      return true
    }

    if (pathname === '/firebase-config.json' && req.method === 'GET') {
      sendJson(res, 200, { ...firebaseConfig, vapidKey })
      return true
    }

    if (pathname === '/api/push/register' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req))
      if (!body.supervisorId || !body.token) {
        sendJson(res, 400, { ok: false })
        return true
      }
      const store = load()
      const tokens = store.tokens.filter(
        (item) => !(item.supervisorId === body.supervisorId && item.token === body.token),
      )
      tokens.push({ supervisorId: body.supervisorId, token: body.token })
      save({ ...store, tokens })
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === '/api/push/send' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req))
      if (!body.supervisorId || !body.title) {
        sendJson(res, 400, { ok: false })
        return true
      }
      const event = {
        id: body.id || `push-${Date.now()}`,
        supervisorId: body.supervisorId,
        title: body.title,
        body: body.body ?? '',
        createdAt: new Date().toISOString(),
      }
      const store = load()
      save({ ...store, events: [event, ...store.events].slice(0, 80) })
      const tokens = store.tokens.filter((item) => item.supervisorId === event.supervisorId)
      const errors = []
      const cloud = await messaging()
      if (!cloud) errors.push('Firebase Admin is not initialized')
      else if (!tokens.length) errors.push('No FCM token saved for this supervisor')
      else {
        for (const item of tokens) {
          try {
            await cloud.send({
              token: item.token,
              notification: { title: event.title, body: event.body },
              webpush: { fcmOptions: { link: '/supervisor' } },
            })
          } catch (error) {
            errors.push(error instanceof Error ? error.message : 'FCM send failed')
          }
        }
      }
      if (errors.length) console.error('[push]', errors.join('; '))
      sendJson(res, 200, { ok: errors.length === 0, id: event.id, errors })
      return true
    }

    if (pathname === '/api/push/inbox' && req.method === 'GET') {
      const supervisorId = url.searchParams.get('supervisorId') ?? ''
      const events = load().events.filter((item) => item.supervisorId === supervisorId)
      sendJson(res, 200, { events })
      return true
    }

    if (pathname.startsWith('/api/push') || pathname === '/firebase-config.json' || pathname === '/firebase-messaging-sw.js') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' })
      return true
    }

    return false
  }

  return { handle }
}
