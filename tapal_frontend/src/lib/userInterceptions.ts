import { useSyncExternalStore } from 'react'
import { djangoToken } from './djangoApi'
import { currentPortal, portalGet, portalSend, resultsOf } from './serverApi'

/** A shopper a brand ambassador spoke with during a store visit. */
export type UserInterception = {
  id: string
  baId: string
  baName: string
  storeId: number | null
  storeName: string
  name: string
  contact: string
  cityArea: string
  previousBrand: string
  previousSku: string
  currentSku: string
  feedback: string
  createdAt: string
  /** Recorded on this device but not accepted by the server yet; sent again on the next sync. */
  unsent?: boolean
}

const STORAGE_KEY = 'ba-user-interceptions-v1'

function load(): UserInterception[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is UserInterception =>
        !!row &&
        typeof row.id === 'string' &&
        typeof row.baId === 'string' &&
        typeof row.name === 'string' &&
        typeof row.contact === 'string' &&
        typeof row.cityArea === 'string' &&
        typeof row.previousBrand === 'string' &&
        typeof row.previousSku === 'string' &&
        typeof row.currentSku === 'string' &&
        typeof row.feedback === 'string',
    )
  } catch {
    return []
  }
}

let records = load()
const listeners = new Set<() => void>()

function commit(next: UserInterception[]) {
  records = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // keep the in-memory list
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function sendInterception(entry: UserInterception) {
  if (currentPortal() !== 'ba') return
  try {
    const { unsent: _unsent, ...body } = entry
    void _unsent
    const saved = await portalSend<UserInterception>('/api/interceptions/', 'POST', body, 'ba')
    if (saved) commit(records.map((item) => (item.id === entry.id ? saved : item)))
  } catch (error) {
    console.warn('[interceptions] not sent yet:', error instanceof Error ? error.message : error)
  }
}

/** Loads interceptions from the server (/api/interceptions/) and sends any this device still holds. */
export async function syncInterceptions() {
  const portal = currentPortal()
  if (portal === 'shopper' || (portal === 'office' && !djangoToken())) return
  if (portal === 'ba') for (const entry of records.filter((r) => r.unsent)) await sendInterception(entry)
  const rows = resultsOf(await portalGet<{ results: UserInterception[] }>('/api/interceptions/', portal))
  if (!rows) return
  commit([...records.filter((r) => r.unsent && !rows.some((row) => row.id === r.id)), ...rows])
}

export function useUserInterceptions() {
  return useSyncExternalStore(subscribe, () => records, () => [])
}

export function submitUserInterception(input: Omit<UserInterception, 'id' | 'createdAt'>) {
  const entry: UserInterception = {
    ...input,
    name: input.name.trim(),
    contact: input.contact.trim(),
    cityArea: input.cityArea.trim(),
    previousBrand: input.previousBrand.trim(),
    previousSku: input.previousSku.trim(),
    currentSku: input.currentSku.trim(),
    feedback: input.feedback.trim(),
    id: `int-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  }
  commit([{ ...entry, unsent: true }, ...records].slice(0, 1000))
  void sendInterception(entry)
  return entry
}
