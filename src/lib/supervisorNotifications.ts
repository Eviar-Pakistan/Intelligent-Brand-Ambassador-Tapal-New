import { useSyncExternalStore } from 'react'
import { supervisorOfStore } from './supervisors'

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

function notifyAttendance(
  kind: 'check-in' | 'check-out',
  input: { baName: string; storeId: number; storeName: string; at: Date },
) {
  const supervisor = supervisorOfStore(input.storeId)
  if (!supervisor) return
  const time = input.at.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })
  const verb = kind === 'check-in' ? 'checked in' : 'checked out'
  const note: SupervisorNotification = {
    id: `${kind}-${input.storeId}-${input.at.getTime()}`,
    supervisorId: supervisor.id,
    message: `${input.baName} ${verb} at ${input.storeName} · ${time}`,
    createdAt: input.at.toISOString(),
  }
  const existing = load()
  if (existing.some((item) => item.id === note.id)) return
  commit([note, ...existing].slice(0, 40))
  const title = kind === 'check-in' ? 'BA checked in' : 'BA checked out'
  void fetch('/api/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: note.id,
      supervisorId: supervisor.id,
      title,
      body: note.message,
    }),
  }).catch(() => undefined)
}

/** Tell the supervisor of this store that their BA just checked in. */
export function notifyBaCheckIn(input: { baName: string; storeId: number; storeName: string; at: Date }) {
  notifyAttendance('check-in', input)
}

/** Tell the supervisor of this store that their BA just checked out. */
export function notifyBaCheckOut(input: { baName: string; storeId: number; storeName: string; at: Date }) {
  notifyAttendance('check-out', input)
}

export function mergeRemoteNotifications(
  events: { id: string; supervisorId: string; body: string; createdAt: string }[],
) {
  const current = load()
  const known = new Set(current.map((item) => item.id))
  const fresh = events.filter((event) => event.id && !known.has(event.id))
  if (!fresh.length) return
  for (const event of fresh) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('BA attendance', { body: event.body })
    }
  }
  commit(
    [
      ...fresh.map((event) => ({
        id: event.id,
        supervisorId: event.supervisorId,
        message: event.body,
        createdAt: event.createdAt,
      })),
      ...current,
    ].slice(0, 40),
  )
}

export function clearSupervisorNotifications(supervisorId: string) {
  commit(load().filter((n) => n.supervisorId !== supervisorId))
}

export function useSupervisorNotifications(supervisorId: string | undefined) {
  const all = useSyncExternalStore(subscribe, load)
  if (!supervisorId) return []
  return all.filter((n) => n.supervisorId === supervisorId)
}
