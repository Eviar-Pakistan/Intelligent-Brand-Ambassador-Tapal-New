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
  if (rows) commit(rows)
}

function sameLocalDay(iso: string, now: Date) {
  const date = new Date(iso)
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
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

export function earlyCheckoutsForToday(list: EarlyCheckout[], storeIds?: number[], now = new Date()) {
  return list.filter(
    (row) => sameLocalDay(row.at, now) && (storeIds ? storeIds.includes(row.storeId) : true),
  )
}
