import { useSyncExternalStore } from 'react'
import { currentBaAccountId, isDemoBa } from './baAccounts'
import { djangoToken } from './djangoApi'
import { currentPortal, portalGet, portalSend, resultsOf } from './serverApi'

export type InterceptionStatus = 'productive' | 'trialist' | 'non_productive'

export const INTERCEPTION_STATUSES: { value: InterceptionStatus; label: string }[] = [
  { value: 'productive', label: 'Productive' },
  { value: 'non_productive', label: 'Non-Productive' },
]

/** Competitor brands a shopper may have used before this interception. */
export const PREVIOUS_BRANDS = ['Tapal', 'Lipton', 'Vital', 'Supreme', 'Others'] as const

export function interceptionStatusLabel(status: InterceptionStatus) {
  if (status === 'trialist') return 'Trialist'
  return INTERCEPTION_STATUSES.find((item) => item.value === status)?.label ?? ''
}

/** One purchased city SKU with quantity (only qty > 0 is submitted). */
export type PurchasedSkuQty = { sku: string; qty: number }

/** A shopper a brand ambassador spoke with during a store visit. */
export type UserInterception = {
  id: string
  baId: string
  baName: string
  storeId: number | null
  storeName: string
  /** City of the store this interception was recorded at. */
  storeCity?: string
  /** Subtown of that store. */
  storeSubtown?: string
  name: string
  contact: string
  cityArea: string
  previousBrand: string
  previousSku: string
  /** Joined display string, e.g. "DD 40gm RTB × 2, Mango 45gm × 1". */
  currentSku: string
  /** SKU labels with qty > 0 (legacy / display). */
  currentSkus?: string[]
  /** Structured purchased SKUs with quantities (preferred on POST). */
  currentSkuQtys?: PurchasedSkuQty[]
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
  const currentSkuQtys = (input.currentSkuQtys ?? [])
    .map((row) => ({
      sku: String(row.sku ?? '').trim(),
      qty: Math.max(0, Math.floor(Number(row.qty) || 0)),
    }))
    .filter((row) => row.sku && row.qty > 0)
  const currentSkus = currentSkuQtys.length
    ? currentSkuQtys.map((row) => row.sku)
    : (input.currentSkus ?? []).map((s) => s.trim()).filter(Boolean)
  const currentSku = (
    input.currentSku ||
    (currentSkuQtys.length
      ? currentSkuQtys.map((row) => `${row.sku} × ${row.qty}`).join(', ')
      : currentSkus.join(', '))
  ).trim()
  const entry: UserInterception = {
    ...input,
    name: input.name.trim(),
    contact: input.contact.trim(),
    cityArea: input.cityArea.trim(),
    previousBrand: input.previousBrand.trim(),
    previousSku: input.previousSku.trim(),
    currentSku,
    currentSkus,
    currentSkuQtys,
    feedback: input.feedback.trim(),
    id: `int-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  }
  const localOnly = isDemoBa(entry.baId)
  commit([{ ...entry, ...(localOnly ? {} : { unsent: true }) }, ...records].slice(0, 1000))
  if (!localOnly) void sendInterception(entry)
  return entry
}

/** Shopper came from another brand. Used by the "Switched to Tapal" badge and filter. */
export function switchedToTapal(previousBrand: string) {
  const brand = (previousBrand || '').trim().toLowerCase()
  return !!brand && !brand.includes('tapal')
}

const TAPAL_SPELLING = /tapal|tapl|tapla|tapql|yapal|tspal|ta\s*pal|taapl|tapa/i
const COMPETITOR_BRAND =
  /lipton|liptan|liptom|liton|lupton|lioton|tipton|\blip\b|vital|vitap|vutal|\bvita\b|\bvit\b|supreme|suprem|\bsup\b|deer|dear|qamar|meezan|mezan|meeza|nayab|lose\s*tea|ultra\s*rich|green\s*leaf|sleem|zeba/i
const TAPAL_PRODUCT =
  /daned|danad|danced|dandar|tezdum|tez\s*dum|taz\s*dum|tazdum|texdum|tezdam|family\s*mix|famil\s*mix|\bfm\b|\btdd\b|\bdd\b|\bgt\b|\btb\b|green\s*tea|teabag|tea\s*bag/i

/** Same brand test as the server: Tapal spellings, then competitors, then Tapal products. */
export function isTapalPreviousBrand(previousBrand: string) {
  const brand = (previousBrand || '').trim()
  if (!brand) return false
  if (TAPAL_SPELLING.test(brand)) return true
  if (COMPETITOR_BRAND.test(brand)) return false
  return TAPAL_PRODUCT.test(brand)
}

function isProductiveInterception(status: string | undefined, currentSku: string | undefined) {
  const outcome = (status || '').trim() || ((currentSku || '').trim() ? 'productive' : 'non_productive')
  return outcome === 'productive'
}

/** Totals for one BA's interceptions only. */
export function baInterceptionStats(rows: Pick<UserInterception, 'status' | 'currentSku' | 'previousBrand'>[]) {
  const productiveCalls = rows.filter((row) => isProductiveInterception(row.status, row.currentSku)).length
  const converted = rows.filter((row) => countsTowardConversion(row)).length
  const totalInterceptions = rows.length
  return {
    totalInterceptions,
    productiveCalls,
    nonProductiveCalls: totalInterceptions - productiveCalls,
    conversion: totalInterceptions ? Math.round((converted / totalInterceptions) * 1000) / 10 : 0,
  }
}

/** Productive, previous brand filled in, and that brand is not Tapal. */
export function countsTowardConversion(row: Pick<UserInterception, 'status' | 'currentSku' | 'previousBrand'>) {
  const brand = (row.previousBrand || '').trim()
  if (!brand || isTapalPreviousBrand(brand)) return false
  return isProductiveInterception(row.status, row.currentSku)
}

