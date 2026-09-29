import { useSyncExternalStore } from 'react'
import { stores, type Store } from '../data/mock'
import { currentPortal, portalGet } from './serverApi'

/**
 * Stores created by Head Office. They are saved on the server and copied into the shared
 * `stores` list, which is what the store screens read.
 */

export type Footfall = Store['footfall']

export type StoreInput = {
  storeCode: string
  name: string
  city: string
  footfall: Footfall
  address: string
  latitude: number | null
  longitude: number | null
  peakHours: string
  contactPerson: string
  contactPhone: string
}

export type CreatedStore = StoreInput & { id: number; slug: string; createdAt: string }

export const CITIES = [
  'Lahore',
  'Karachi',
  'Islamabad',
  'Rawalpindi',
  'Faisalabad',
  'Multan',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Gujranwala',
  'Hyderabad',
]
export const FOOTFALLS: Footfall[] = ['High', 'Medium', 'Low']
export const DEFAULT_PEAK_HOURS = '5 PM — 9 PM'

/** Map pins are stored to 6 decimal places. Extra digits from a paste are rounded, not rejected. */
export function roundCoord(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

const STORAGE_KEY = 'created-stores-v1'

let created: CreatedStore[] = []
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCreatedStores() {
  return useSyncExternalStore(subscribe, () => created)
}

export function findCreatedStore(id: number) {
  return created.find((c) => c.id === id) ?? null
}

export type ApiStoreRow = {
  id: number
  name: string
  city: string
  address?: string
  footfall?: string
  peak?: string[]
  peak_hours?: string
  contact_name?: string
  contact_phone?: string
  status?: string
  coverage?: number
  bas?: number
  today_footfall?: number
  engagement?: number
  conversion?: number
  store_code?: string
  qr_slug?: string
  latitude?: string | number | null
  longitude?: string | number | null
  /** BAs working there today (supervisor overview) */
  assigned?: Store['assigned']
}

function remember(row: ApiStoreRow) {
  if (!row?.id || !row.name) return null
  const footfall: Footfall = row.footfall === 'High' || row.footfall === 'Low' ? row.footfall : 'Medium'
  const status: Store['status'] =
    row.status === 'LIVE'
      ? 'Covered'
      : row.status === 'PARTIAL'
        ? 'PARTIAL'
        : row.status === 'INACTIVE'
          ? 'Inactive'
          : 'NEEDS BA'
  const latitude = row.latitude == null || row.latitude === '' ? null : Number(row.latitude)
  const longitude = row.longitude == null || row.longitude === '' ? null : Number(row.longitude)
  const record: CreatedStore = {
    storeCode: (row.store_code || '').trim().toUpperCase(),
    name: row.name,
    city: row.city,
    footfall,
    address: row.address ?? '',
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    peakHours: row.peak?.[0] || row.peak_hours || '',
    contactPerson: row.contact_name ?? '',
    contactPhone: row.contact_phone ?? '',
    id: row.id,
    slug: row.qr_slug || `s${row.id}-api`,
    createdAt: new Date().toISOString(),
  }
  stores.push({
    id: row.id,
    storeCode: record.storeCode,
    name: row.name,
    city: row.city,
    footfall,
    bas: row.bas ?? 0,
    coverage: row.coverage ?? 0,
    status,
    todayFootfall: row.today_footfall ?? 0,
    engagement: Math.round(row.engagement ?? 0),
    conversion: Math.round(row.conversion ?? 0),
    peak: row.peak?.length ? row.peak : record.peakHours ? [record.peakHours] : [],
    assigned: row.assigned ?? [],
    qrCode: record.slug,
  })
  created = [record, ...created.filter((item) => item.id !== record.id)]
  return record
}

function publish() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(created))
  } catch {
    // keep the in-memory list
  }
  listeners.forEach((listener) => listener())
}

/** The server roster replaces the list, so hardcoded and deleted stores disappear. */
export function replaceStoresFromApi(rows: ApiStoreRow[]) {
  stores.splice(0, stores.length)
  created = []
  for (const row of rows) remember(row)
  publish()
}

/** Add a Django store to the same list the screens already read. */
export function adoptApiStore(row: ApiStoreRow) {
  if (!row?.id || stores.some((store) => store.id === row.id)) return
  remember(row)
  publish()
}

let baCurrentStoreId: number | null = null

/** The store the signed-in BA works at today (from their shift), once loaded. */
export function baCurrentStore() {
  return baCurrentStoreId
}

/** On the BA's device: loads the stores that BA works at, so their forms can offer them. */
export async function syncBaStores() {
  if (currentPortal() !== 'ba') return
  const data = await portalGet<{ current_store_id: number | null; results: ApiStoreRow[] }>('/api/ba/stores/', 'ba')
  if (!data) return
  baCurrentStoreId = data.current_store_id
  upsertApiStores(data.results)
  listeners.forEach((listener) => listener())
}

/**
 * Add or refresh stores from the server without dropping the rest. BA and supervisor devices
 * use this: they never load the full Head Office list, only the stores they work with.
 */
export function upsertApiStores(rows: ApiStoreRow[]) {
  let changed = false
  for (const row of rows) {
    if (!row?.id || !row.name) continue
    const at = stores.findIndex((store) => store.id === row.id)
    if (at >= 0) stores.splice(at, 1)
    remember(row)
    changed = true
  }
  if (changed) publish()
}

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

export function storeExists(name: string, city: string) {
  return stores.some((s) => norm(s.name) === norm(name) && norm(s.city) === norm(city))
}

async function readApiError(res: Response) {
  try {
    const data = (await res.json()) as { detail?: string } & Record<string, unknown>
    if (data.detail) return data.detail
    const parts = Object.values(data)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => typeof value === 'string')
    if (parts.length) return parts.join(' ')
  } catch {
    // use the fallback below
  }
  return 'The store could not be saved on the server.'
}

/** Saves each store on the server and adds it to the list with the server id and QR slug. */
export async function createStores(inputs: StoreInput[]): Promise<CreatedStore[]> {
  const { djangoFetch, djangoToken } = await import('./djangoApi')
  if (!djangoToken()) {
    throw new Error('Sign in as Head Office first. The store is saved on the server.')
  }
  const added: CreatedStore[] = []
  for (const input of inputs) {
    const res = await djangoFetch('/api/stores/', {
      method: 'POST',
      body: JSON.stringify({
        store_code: input.storeCode.trim().toUpperCase(),
        name: input.name.trim(),
        city: input.city.trim(),
        address: input.address.trim(),
        footfall: input.footfall,
        peak_hours: input.peakHours,
        contact_name: input.contactPerson,
        contact_phone: input.contactPhone,
        latitude: input.latitude == null ? null : roundCoord(input.latitude),
        longitude: input.longitude == null ? null : roundCoord(input.longitude),
      }),
    })
    if (!res.ok) throw new Error(await readApiError(res))
    const row = (await res.json()) as ApiStoreRow
    const record = remember(row)
    if (!record?.id || !record.slug) throw new Error('The server did not return the new store.')
    added.push(record)
    publish()
  }
  return added
}

// ─── Shopper journey link + QR ───────────────────────────────────────────────

/** Path segment that identifies a store in its shopper link. */
export function storeSlug(store: Pick<Store, 'id' | 'qrCode'>) {
  return findCreatedStore(store.id)?.slug ?? `s${store.id}-demo`
}

/**
 * Link a shopper opens (by scanning the QR) to start that store's journey. The store name and
 * city ride along so the journey can greet the shopper even on a phone that has never seen
 * this browser's store list.
 */
export function shopperPath(store: Pick<Store, 'id' | 'qrCode' | 'name' | 'city'>) {
  const query = new URLSearchParams({ store: store.name, city: store.city })
  return `/shopper/${storeSlug(store)}?${query}`
}

export function shopperLink(store: Pick<Store, 'id' | 'qrCode' | 'name' | 'city'>) {
  return `${window.location.origin}${shopperPath(store)}`
}

export type ShopperStore = { id: number | null; name: string; city: string; slug?: string }

const SHOPPER_KEY = 'shopper-store'

/** Works out which store a scanned link is for, and remembers it for this shopper session. */
export function enterShopperStore(slug: string, params: URLSearchParams): ShopperStore | null {
  const id = Number(/^s(\d+)-/.exec(slug)?.[1])
  const known = Number.isFinite(id) ? stores.find((s) => s.id === id) : undefined
  const name = known?.name ?? params.get('store') ?? ''
  const shopperStore = name
    ? { id: known?.id ?? null, name, city: known?.city ?? params.get('city') ?? '', slug }
    : null
  try {
    if (shopperStore) sessionStorage.setItem(SHOPPER_KEY, JSON.stringify(shopperStore))
  } catch {
    // ignore
  }
  return shopperStore
}

/**
 * A shopper's phone has no store list, so the scanned QR slug is looked up on the server.
 * Keeps the store (with its QR slug) for the rest of the visit.
 */
export async function resolveShopperStore(slug: string): Promise<ShopperStore | null> {
  try {
    const response = await fetch(`/api/shopper/store/${encodeURIComponent(slug)}/`)
    if (!response.ok) return getShopperStore()
    const row = (await response.json()) as { id: number; name: string; city: string; qr_slug: string }
    const shopperStore: ShopperStore = { id: row.id, name: row.name, city: row.city, slug: row.qr_slug }
    sessionStorage.setItem(SHOPPER_KEY, JSON.stringify(shopperStore))
    return shopperStore
  } catch {
    return getShopperStore()
  }
}

export function getShopperStore(): ShopperStore | null {
  try {
    const raw = sessionStorage.getItem(SHOPPER_KEY)
    return raw ? (JSON.parse(raw) as ShopperStore) : null
  } catch {
    return null
  }
}

export async function qrDataUrl(text: string, width = 320) {
  const mod = (await import('qrcode')) as unknown as {
    toDataURL?: (t: string, o: object) => Promise<string>
    default?: { toDataURL: (t: string, o: object) => Promise<string> }
  }
  const toDataURL = mod.toDataURL ?? mod.default!.toDataURL
  return toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M' })
}

// ─── Excel template + bulk upload ────────────────────────────────────────────

const SHEET = 'Stores'
const COLUMNS = [
  { key: 'storeCode', header: 'Store code', width: 16 },
  { key: 'name', header: 'Store name *', width: 30 },
  { key: 'city', header: 'City *', width: 16 },
  { key: 'footfall', header: 'Footfall', width: 12 },
  { key: 'address', header: 'Address', width: 36 },
  { key: 'latitude', header: 'Latitude', width: 12 },
  { key: 'longitude', header: 'Longitude', width: 12 },
  { key: 'peakHours', header: 'Peak hours', width: 16 },
  { key: 'contactPerson', header: 'Contact person', width: 20 },
  { key: 'contactPhone', header: 'Contact phone', width: 18 },
] as const

const EXAMPLE_STORE = 'Example store'

/** Blank rows under the header so Excel can accept a pasted block of stores. */
function sheetWithPasteRoom(XLSX: { utils: { aoa_to_sheet: (rows: unknown[][]) => Record<string, unknown> } }, rows: unknown[][]) {
  const width = COLUMNS.length
  const padded = rows.map((row) => {
    const copy = [...row]
    while (copy.length < width) copy.push('')
    return copy
  })
  while (padded.length < 101) padded.push(Array(width).fill(''))
  return XLSX.utils.aoa_to_sheet(padded)
}

/** Downloads the .xlsx a user fills in to create many stores at once. */
export async function downloadStoreTemplate() {
  const XLSX = await import('xlsx')
  const sheet = sheetWithPasteRoom(XLSX, [
    COLUMNS.map((c) => c.header),
    ['', EXAMPLE_STORE, 'Lahore', 'High', 'Paste your stores over this row, or start on the next row', '', '', '5 PM - 9 PM', '', ''],
  ])
  sheet['!cols'] = COLUMNS.map((c) => ({ wch: c.width }))

  const help = XLSX.utils.aoa_to_sheet([
    ['How to fill the store template'],
    [],
    [`1. On the "${SHEET}" sheet, paste or type one store per row under the header. Do not change the header row.`],
    ['The example row is ignored. Paste over it, or leave it and start your stores on the next row.'],
    ['2. Store name and City are required. Store code is optional — leave it blank and a unique code is created.'],
    [`3. Footfall must be High, Medium or Low (blank = Medium). Peak hours is free text (blank = ${DEFAULT_PEAK_HOURS}).`],
    ['4. Latitude and Longitude are decimal numbers, e.g. 24.8607 and 67.0011.'],
    ['5. A store that already exists (same name and city) is skipped.'],
    ['6. Save the file, then upload it on the Stores page. Each store gets its own shopper QR code.'],
    [],
    COLUMNS.map((c) => c.header),
    ['ST-4K7M2Q', 'Carrefour Johar Town', 'Lahore', 'High', 'Main Boulevard, Johar Town', 31.4697, 74.2728, '5 PM — 9 PM', 'Ali Raza', '0300-1234567'],
  ])
  help['!cols'] = COLUMNS.map((c) => ({ wch: c.width }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, SHEET)
  XLSX.utils.book_append_sheet(wb, help, 'Instructions')
  XLSX.writeFile(wb, 'Tapal_Store_Creation_Template.xlsx')
}

export type ParsedStoreRow = { row: number; input: StoreInput }
export type StoreParseResult = { rows: ParsedStoreRow[]; errors: string[] }

const headerKey = (h: unknown) => String(h ?? '').replace('*', '').trim().toLowerCase()

/** Reads a filled template. Valid rows are returned even when others have problems. */
export async function parseStoreFile(file: File): Promise<StoreParseResult> {
  const XLSX = await import('xlsx')

  let table: unknown[][]
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const name = wb.SheetNames.includes(SHEET) ? SHEET : wb.SheetNames[0]
    table = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true })
  } catch {
    return { rows: [], errors: ['This file could not be read. Please upload the downloaded .xlsx template.'] }
  }

  const headerAt = table.findIndex((r) => r.some((c) => headerKey(c) === 'store name'))
  if (headerAt === -1) {
    return {
      rows: [],
      errors: ['This is not the store template (no "Store name" column). Download the template and fill that.'],
    }
  }
  const col = new Map<string, number>()
  table[headerAt].forEach((h, i) => col.set(headerKey(h), i))
  const cell = (r: unknown[], header: string) => {
    const v = r[col.get(header) ?? -1]
    return v === undefined || v === null ? '' : String(v).trim()
  }

  const rows: ParsedStoreRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  const seenCodes = new Set<string>()

  table.slice(headerAt + 1).forEach((r, i) => {
    const rowNo = headerAt + i + 2
    if (r.every((c) => String(c ?? '').trim() === '')) return

    const name = cell(r, 'store name')
    const city = cell(r, 'city')
    const storeCode = cell(r, 'store code').toUpperCase()
    if (name.toLowerCase() === EXAMPLE_STORE.toLowerCase()) return
    const problems: string[] = []
    if (!name) problems.push('Store name is required')
    if (!city) problems.push('City is required')
    if (storeCode.length > 32) problems.push('Store code must be 32 characters or fewer')
    if (storeCode) {
      if (seenCodes.has(storeCode)) problems.push('Duplicate store code in this file')
      else if (stores.some((s) => s.storeCode.toUpperCase() === storeCode)) problems.push('This store code is already used')
      seenCodes.add(storeCode)
    }

    const footRaw = cell(r, 'footfall')
    const footfall = FOOTFALLS.find((f) => f.toLowerCase() === footRaw.toLowerCase())
    if (footRaw && !footfall) problems.push(`Footfall must be High, Medium or Low (found "${footRaw}")`)

    const coord = (header: string, limit: number) => {
      const text = cell(r, header)
      if (!text) return null
      const n = Number(text)
      if (!Number.isFinite(n) || Math.abs(n) > limit) {
        problems.push(`${header[0].toUpperCase()}${header.slice(1)} must be a number between -${limit} and ${limit} (found "${text}")`)
        return null
      }
      return roundCoord(n)
    }
    const latitude = coord('latitude', 90)
    const longitude = coord('longitude', 180)

    if (name && city) {
      const key = `${norm(name)}|${norm(city)}`
      if (seen.has(key)) problems.push('Duplicate of an earlier row in this file')
      else if (storeExists(name, city)) problems.push('A store with this name and city already exists')
      seen.add(key)
    }

    if (problems.length > 0) {
      errors.push(`Row ${rowNo}${name ? ` (${name})` : ''}: ${problems.join('; ')}.`)
      return
    }
    rows.push({
      row: rowNo,
      input: {
        storeCode,
        name,
        city,
        footfall: footfall ?? 'Medium',
        address: cell(r, 'address'),
        latitude,
        longitude,
        peakHours: cell(r, 'peak hours') || DEFAULT_PEAK_HOURS,
        contactPerson: cell(r, 'contact person'),
        contactPhone: cell(r, 'contact phone'),
      },
    })
  })

  if (rows.length === 0 && errors.length === 0) errors.push('No stores found. Add one store per row under the header.')
  return { rows, errors }
}

/** Downloads a sheet of store names with their shopper links, e.g. to print QR posters. */
export async function downloadStoreLinks(list: Pick<Store, 'id' | 'qrCode' | 'name' | 'city' | 'storeCode'>[]) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Store code', 'Store ID', 'Store', 'City', 'Shopper link'],
    ...list.map((s) => [s.storeCode, s.id, s.name, s.city, shopperLink(s)]),
  ])
  sheet['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 30 }, { wch: 16 }, { wch: 90 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Shopper links')
  XLSX.writeFile(wb, 'Tapal_Store_Shopper_Links.xlsx')
}
