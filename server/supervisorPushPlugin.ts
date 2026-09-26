import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

type PushToken = { supervisorId: string; token: string }
type PushEvent = { id: string; supervisorId: string; title: string; body: string; createdAt: string }

type Store = { tokens: PushToken[]; events: PushEvent[] }

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function serviceWorkerSource(config: Record<string, string>) {
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

export function supervisorPushPlugin(): Plugin {
  const file = path.resolve('data/supervisor-push.json')
  const serviceAccountPath = path.resolve('firebase-service-account.json')
  return {
    name: 'supervisor-push',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      const firebaseConfig = {
        apiKey: env.VITE_FIREBASE_API_KEY ?? '',
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
        projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
        appId: env.VITE_FIREBASE_APP_ID ?? '',
      }
      const vapidKey = env.VITE_FIREBASE_VAPID_KEY ?? ''

      let messagingReady: Promise<{ send: (message: object) => Promise<string> } | null> | null = null
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

      function load(): Store {
        try {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Store
          return {
            tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
            events: Array.isArray(parsed.events) ? parsed.events : [],
          }
        } catch {
          return { tokens: [], events: [] }
        }
      }

      function save(store: Store) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(store))
      }

      server.middlewares.use('/firebase-messaging-sw.js', (_req, res) => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Service-Worker-Allowed', '/')
        res.end(serviceWorkerSource(firebaseConfig))
      })

      server.middlewares.use('/firebase-config.json', (_req, res) => {
        sendJson(res, 200, { ...firebaseConfig, vapidKey })
      })

      server.middlewares.use('/api/push', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const pathname = url.pathname.replace(/\/$/, '') || '/'
        if (req.method === 'POST' && (pathname === '/register' || pathname === '/api/push/register')) {
          const body = JSON.parse(await readBody(req)) as PushToken
          if (!body.supervisorId || !body.token) return sendJson(res, 400, { ok: false })
          const store = load()
          const tokens = store.tokens.filter(
            (item) => !(item.supervisorId === body.supervisorId && item.token === body.token),
          )
          tokens.push({ supervisorId: body.supervisorId, token: body.token })
          save({ ...store, tokens })
          return sendJson(res, 200, { ok: true })
        }

        if (req.method === 'POST' && (pathname === '/send' || pathname === '/api/push/send')) {
          const body = JSON.parse(await readBody(req)) as PushEvent
          if (!body.supervisorId || !body.title) return sendJson(res, 400, { ok: false })
          const event: PushEvent = {
            id: body.id || `push-${Date.now()}`,
            supervisorId: body.supervisorId,
            title: body.title,
            body: body.body ?? '',
            createdAt: new Date().toISOString(),
          }
          const store = load()
          save({ ...store, events: [event, ...store.events].slice(0, 80) })
          const tokens = store.tokens.filter((item) => item.supervisorId === event.supervisorId)
          const errors: string[] = []
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
          return sendJson(res, 200, { ok: errors.length === 0, id: event.id, errors })
        }

        if (req.method === 'GET' && (pathname === '/inbox' || pathname === '/api/push/inbox')) {
          const supervisorId = url.searchParams.get('supervisorId') ?? ''
          const events = load().events.filter((item) => item.supervisorId === supervisorId)
          return sendJson(res, 200, { events })
        }

        sendJson(res, 404, { ok: false })
      })
    },
  }
}
