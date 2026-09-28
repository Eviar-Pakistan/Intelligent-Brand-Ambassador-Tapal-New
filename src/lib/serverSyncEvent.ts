/** Fired by <ServerSync> when screens should reload their data from the server. */
export const SERVER_SYNC_EVENT = 'app:server-sync'

export function requestServerSync() {
  window.dispatchEvent(new Event(SERVER_SYNC_EVENT))
}
