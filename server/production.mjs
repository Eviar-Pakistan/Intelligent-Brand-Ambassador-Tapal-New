import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const root = process.cwd()
const dist = path.join(root, 'dist')
const port = Number(process.env.PORT || 4173)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

function proxyDjango(req, res) {
  // Tell Django the address the visitor used, so the links it builds (photos, videos, QR codes)
  // point at the site and not at 127.0.0.1.
  const headers = {
    ...req.headers,
    host: '127.0.0.1:8000',
    'x-forwarded-host': req.headers['x-forwarded-host'] ?? req.headers.host ?? '',
    'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? 'http',
  }
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: 8000,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'Django is not running on port 8000' }))
    }
  })
  req.pipe(upstream)
}

function sendFile(res, filePath) {
  const body = fs.readFileSync(filePath)
  res.statusCode = 200
  res.setHeader('Content-Type', types[path.extname(filePath)] ?? 'application/octet-stream')
  res.end(body)
}

function goesToDjango(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/media/') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/static/') ||
    pathname === '/firebase-config.json' ||
    pathname === '/firebase-messaging-sw.js'
  )
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  if (goesToDjango(requestUrl.pathname)) {
    proxyDjango(req, res)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end('Method Not Allowed')
    return
  }

  const relative = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.join(dist, relative)
  if (filePath.startsWith(dist) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (req.method === 'HEAD') {
      res.statusCode = 200
      res.end()
      return
    }
    sendFile(res, filePath)
    return
  }

  if (path.extname(requestUrl.pathname)) {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const index = path.join(dist, 'index.html')
  if (!fs.existsSync(index)) {
    res.statusCode = 500
    res.end('Build the app first: npm run build')
    return
  }
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.end()
    return
  }
  sendFile(res, index)
})

server.listen(port, () => {
  console.log(`Tapal app listening on http://127.0.0.1:${port}`)
})
