import { useSyncExternalStore } from 'react'
import { currentPortal, portalFetch, portalGet, resultsOf } from './serverApi'

/**
 * The supervisor's bell. When a BA checks in or out at one of the supervisor's stores, the server
 * records the notification (/api/supervisor/notifications/) and sends the push to the supervisor's
 * phone itself. The app only reads the list.
 */

export type SupervisorNotification = {
  id: string
  supervisorId: string
  message: string
  createdAt: string
}

const STORAGE_KEY = 'supervisor-notifications-v1'
const listeners = new Set<() => void>()
let cache: SupervisorNotification[] | null = null

function load(): SupervisorNotification[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (n): n is SupervisorNotification =>
            !!n &&
            typeof n.id === 'string' &&
            typeof n.supervisorId === 'string' &&
            typeof n.message === 'string',
        )
      : []
  } catch {
    cache = []
  }
  return cache
}

function commit(next: SupervisorNotification[]) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // keep the in-memory list
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Loads the signed-in supervisor's notifications from the server (replaces what this browser had). */
export async function syncSupervisorNotifications() {
  if (currentPortal() !== 'supervisor') return
  const rows = resultsOf(await portalGet<{ results: SupervisorNotification[] }>('/api/supervisor/notifications/'))
  if (!rows) return
  const ids = new Set(rows.map((row) => row.supervisorId))
  commit([...rows, ...load().filter((item) => !ids.has(item.supervisorId))].slice(0, 80))
}

export function clearSupervisorNotifications(supervisorId: string) {
  commit(load().filter((n) => n.supervisorId !== supervisorId))
  if (currentPortal() === 'supervisor') {
    void portalFetch('/api/supervisor/notifications/', { method: 'DELETE' }).catch(() => undefined)
  }
}

export function useSupervisorNotifications(supervisorId: string | undefined) {
  const all = useSyncExternalStore(subscribe, load)
  if (!supervisorId) return []
  return all.filter((n) => n.supervisorId === supervisorId)
}
