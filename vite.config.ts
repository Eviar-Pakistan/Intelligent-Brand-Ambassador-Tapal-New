import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { supervisorPushPlugin } from './server/supervisorPushPlugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), supervisorPushPlugin()],
})
