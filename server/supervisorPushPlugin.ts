import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import { createPushRuntime } from './pushApi.mjs'

function mount(middlewares: Connect.Server, root: string) {
  const push = createPushRuntime(root)
  middlewares.use(async (req, res, next) => {
    try {
      if (await push.handle(req, res)) return
    } catch (error) {
      console.error('[push]', error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false }))
      }
      return
    }
    next()
  })
}

export function supervisorPushPlugin(): Plugin {
  return {
    name: 'supervisor-push',
    configureServer(server: ViteDevServer) {
      mount(server.middlewares, server.config.root)
    },
    configurePreviewServer(server: PreviewServer) {
      mount(server.middlewares, server.config.root)
    },
  }
}
