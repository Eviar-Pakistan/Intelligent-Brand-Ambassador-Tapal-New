import { useSyncExternalStore } from 'react'
import { currentBaAccountId, isDemoBa } from './baAccounts'
import { djangoToken } from './djangoApi'
import { currentPortal, portalGet, portalSend, resultsOf } from './serverApi'

export type InterceptionStatus = 'productive' | 'trialist' | 'non_productive'

export const INTERCEPTION_STATUSES: { value: InterceptionStatus; label: string }[] = [
  { value: 'productive', label: 'Productive' },
  { value: 'trialist', label: 'Trialist' },
  { value: 'non_productive', label: 'Non-Productive' },
]

export function interceptionStatusLabel(status: InterceptionStatus) {
  return INTERCEPTION_STATUSES.find((item) => item.value === status)?.label ?? ''
}

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
  status: InterceptionStatus
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
    return parsed
      .filter(
      (row): row is UserInterception =>
        !!row &&
        typeof row.id === 'string' &&
        typeof row.baId === 'string' &&
        !isDemoBa(row.baId) &&
        typeof row.name === 'string' &&
        typeof row.contact === 'string' &&
        typeof row.cityArea === 'string' &&
        typeof row.previousBrand === 'string' &&
        typeof row.previousSku === 'string' &&
        typeof row.currentSku === 'string' &&
        typeof row.feedback === 'string',
      )
      // Records saved before the status existed: a purchased SKU meant productive.
      .map((row) => ({
        ...row,
        status: row.status ?? (row.currentSku.trim() ? 'productive' : 'non_productive'),
      }))
  } catch {
    return []
  }
}

let records = load()
const listeners = new Set<() => void>()

function commit(next: UserInterception[]) {
  records = next
  try {
    // Demo interceptions stay in memory only for this session.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.filter((r) => !isDemoBa(r.baId))))
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
  if (currentPortal() !== 'ba' || isDemoBa(entry.baId)) return
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
  if (portal === 'ba' && isDemoBa(currentBaAccountId() ?? '')) return
  let rows = resultsOf(await portalGet<{ results: UserInterception[] }>('/api/interceptions/', portal))
  if (!rows) return
  if (portal === 'ba') {
    // Anything this BA recorded on this phone that the server does not have yet is sent now
    // (including records saved before the app sent them to the server).
    const me = currentBaAccountId()
    const onServer = new Set(rows.map((row) => row.id))
    const missing = records.filter((r) => r.baId === me && !onServer.has(r.id))
    for (const entry of missing) await sendInterception(entry)
    if (missing.length) rows = resultsOf(await portalGet<{ results: UserInterception[] }>('/api/interceptions/', portal)) ?? rows
  }
  const onServer = new Set(rows.map((row) => row.id))
  // Keep what the server does not have yet (never drop a record before it is saved there).
  commit([
    ...records.filter((r) => !onServer.has(r.id) && (portal === 'ba' || r.unsent || isDemoBa(r.baId))),
    ...rows,
  ])
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
  const localOnly = isDemoBa(entry.baId)
  commit([{ ...entry, ...(localOnly ? {} : { unsent: true }) }, ...records].slice(0, 1000))
  if (!localOnly) void sendInterception(entry)
  return entry
}

/** A shopper counts as converted when they came from another brand (same rule as the server). */
export function switchedToTapal(previousBrand: string) {
  const brand = (previousBrand || '').trim().toLowerCase()
  return !!brand && !brand.includes('tapal')
}

