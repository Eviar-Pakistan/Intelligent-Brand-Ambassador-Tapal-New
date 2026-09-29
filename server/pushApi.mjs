/**
 * Legacy Node push API. Supervisor notifications are handled by Django
 * (`/api/push/...`, `/firebase-config.json`, `/firebase-messaging-sw.js`).
 * Kept only as a reference; production.mjs and vite no longer call this.
 */
export function createPushRuntime() {
  return {
    async handle() {
      return false
    },
  }
}
