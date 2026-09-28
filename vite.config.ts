import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { supervisorPushPlugin } from './server/supervisorPushPlugin.js'

const django = 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss(), supervisorPushPlugin()],
  server: {
    watch: {
      // Django writes the database and answer audio while a BA is assessed.
      // Watching those files reloads the app in the middle of scoring.
      ignored: ['**/tapal_backend/**'],
    },
    proxy: {
      '/api': {
        target: django,
        changeOrigin: true,
        bypass(req) {
          const url = req.url ?? ''
          if (url.startsWith('/api/push')) return url
        },
      },
      '/auth': { target: django, changeOrigin: true },
      '/media': { target: django, changeOrigin: true },
    },
  },
})
