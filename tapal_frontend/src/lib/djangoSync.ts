import { replaceAmbassadorsFromApi, type BaAccount } from './baAccounts'
import { currentMonthKey, replaceTargetsFromApi, type BaMonthTarget } from './baTargets'
import type { EngineReport } from './trainingApi'
import { djangoFetch, djangoToken } from './djangoApi'
import { replaceStoresFromApi, roundCoord, type StoreInput } from './storeRegistry'

type ApiStore = {
  id: number
  store_code?: string
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
  qr_slug?: string
  latitude?: string | number | null
  longitude?: string | number | null
}

type ApiAmbassador = {
  id: number
  name: string
  email?: string
  city?: string
  phone?: string
  status?: string
  invite_token?: string
  ba_code?: string
  created_at?: string
  store?: number | null
  store_name?: string | null
  is_active?: boolean
  report_json?: EngineReport | null
  is_demo?: boolean
}

function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { results?: T[] }).results)) {
    return (payload as { results: T[] }).results
  }
  return []
}

let syncInFlight: Promise<void> | null = null
let lastSyncAt = 0

/** Pull Django stores and ambassadors into the lists the screens already use. Existing rows stay. */
export function syncDjango() {
  if (!djangoToken()) return Promise.resolve()
  if (syncInFlight) return syncInFlight
  // Several screens request this same snapshot during initial navigation. Reuse the recent sync
  // instead of repeating the stores, ambassadors, and targets queries on every route mount.
  if (Date.now() - lastSyncAt < 15_000) return Promise.resolve()
  syncInFlight = syncDjangoData().finally(() => {
    lastSyncAt = Date.now()
    syncInFlight = null
  })
  return syncInFlight
}

async function syncDjangoData() {
  try {
    const [storesRes, ambassadorsRes] = await Promise.all([
      djangoFetch('/api/stores/'),
      djangoFetch('/api/ambassadors/'),
    ])
    if (storesRes.ok) {
      replaceStoresFromApi(asList<ApiStore>(await storesRes.json()))
    }
    if (ambassadorsRes.ok) {
      const rows = asList<ApiAmbassador>(await ambassadorsRes.json())
      replaceAmbassadorsFromApi(rows)
    }
    await syncBaTargets()
  } catch {
    // the screens keep the data they already have
  }
}

export async function syncBaTargets(month = currentMonthKey()) {
  if (!djangoToken()) return
  try {
    const response = await djangoFetch(`/api/ba-targets/?month=${encodeURIComponent(month)}`)
    if (!response.ok) return
    const payload = (await response.json()) as { results?: BaMonthTarget[] }
    replaceTargetsFromApi(Array.isArray(payload.results) ? payload.results : [], month)
  } catch {
    // keep the targets already on screen
  }
}

export function pushStores(inputs: StoreInput[]) {
  if (!djangoToken()) return
  for (const input of inputs) {
    void djangoFetch('/api/stores/', {
      method: 'POST',
      body: JSON.stringify({
        store_code: input.storeCode,
        name: input.name,
        city: input.city,
        address: input.address,
        footfall: input.footfall,
        peak_hours: input.peakHours,
        contact_name: input.contactPerson,
        contact_phone: input.contactPhone,
        latitude: input.latitude == null ? null : roundCoord(input.latitude),
        longitude: input.longitude == null ? null : roundCoord(input.longitude),
      }),
    }).catch(() => undefined)
  }
}

export async function pushAmbassador(account: BaAccount) {
  if (!djangoToken()) return null
  try {
    const response = await djangoFetch('/api/ambassadors/', {
      method: 'POST',
      body: JSON.stringify({
        name: account.name,
        email: account.email,
        city: account.city,
        phone: account.phone,
        is_backup: account.isBackup === true,
        is_demo: account.isDemoAccount === true,
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as ApiAmbassador
  } catch {
    return null
  }
}
