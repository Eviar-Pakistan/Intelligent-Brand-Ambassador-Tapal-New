import type { Plugin } from 'vite'

/**
 * Push + Firebase config are served by Django. This plugin is kept so older
 * imports of supervisorPushPlugin still resolve; it no longer mounts a Node push API.
 */
export function supervisorPushPlugin(): Plugin {
  return {
    name: 'supervisor-push',
  }
}
