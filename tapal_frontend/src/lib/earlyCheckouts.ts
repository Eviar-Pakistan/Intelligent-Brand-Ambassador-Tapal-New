import { useSyncExternalStore } from 'react'
import { isAtOrPastShiftEnd } from '../context/BaShiftContext'
import { ambassadors, stores } from '../data/mock'
import { djangoToken } from './djangoApi'
import { currentPortal, portalGet, resultsOf } from './serverApi'

export type EarlyCheckout = {
  id: string
  baId: string
  baName: string
  storeId: number
  storeName: string
  reason: string
  at: string
}

const STORAGE_KEY = 'ba-early-checkouts-v1'

function load(): EarlyCheckout[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is EarlyCheckout =>
        !!row &&
        typeof row.id === 'string' &&
        typeof row.baId === 'string' &&
        typeof row.baName === 'string' &&
        typeof row.storeId === 'number' &&
        typeof row.storeName === 'string' &&
        typeof row.reason === 'string' &&
        typeof row.at === 'string',
    )
  } catch {
    return []
  }
}

let records = load()
const listeners = new Set<() => void>()

function commit(next: EarlyCheckout[]) {
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

/**
 * Head Office and supervisors load today's early check-outs from the server: they are recorded
 * with the BA's check-out report (/api/early-checkouts/). The BA's own device keeps its local list.
 */
export async function syncEarlyCheckouts() {
  const portal = currentPortal()
  if (portal === 'ba' || portal === 'shopper' || (portal === 'office' && !djangoToken())) return
  const rows = resultsOf(await portalGet<{ results: EarlyCheckout[] }>('/api/early-checkouts/', portal))
  if (!rows) return
  // Normalize server rows (storeId may be null) so the card can always render them.
  commit(
    rows.map((row) => ({
      id: String(row.id),
      baId: String(row.baId ?? ''),
      baName: String(row.baName ?? ''),
      storeId: typeof row.storeId === 'number' ? row.storeId : Number(row.storeId) || 0,
      storeName: String(row.storeName ?? '—'),
      reason: String(row.reason ?? ''),
      at: String(row.at ?? ''),
    })),
  )
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sameLocalDay(iso: string, now: Date) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  return dayKey(date) === dayKey(now)
}

/** Remember a BA who left before shift end. One entry per ambassador per day. */
export function recordEarlyCheckout(input: { baId: string; baName: string; reason: string; at?: Date }) {
  const at = input.at ?? new Date()
  const reason = input.reason.trim()
  if (!reason || isAtOrPastShiftEnd(at)) return
  if (records.some((row) => row.baId === input.baId && sameLocalDay(row.at, at))) return
  const ambassador = ambassadors.find((item) => item.id === input.baId)
  const store = ambassador?.storeId != null ? stores.find((item) => item.id === ambassador.storeId) : undefined
  const entry: EarlyCheckout = {
    id: `early-${input.baId}-${at.getTime()}`,
    baId: input.baId,
    baName: input.baName,
    storeId: store?.id ?? 0,
    storeName: store?.name ?? '—',
    reason,
    at: at.toISOString(),
  }
  commit([entry, ...records].slice(0, 200))
}

export function useEarlyCheckouts() {
  return useSyncExternalStore(subscribe, () => records, () => [])
}

export function earlyCheckoutsForToday(list: EarlyCheckout[], storeIds?: number[]) {
  // /api/early-checkouts/ already scopes by shift.date (business today). Do not
  // re-filter on `at` — overnight checkouts can fall before 05:00 local and would
  // be dropped even though the backend correctly included them.
  return storeIds ? list.filter((row) => storeIds.includes(row.storeId)) : list
}
