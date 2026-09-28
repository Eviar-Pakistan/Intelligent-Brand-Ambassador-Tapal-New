import { replaceAmbassadorsFromApi, type BaAccount } from './baAccounts'
import { replaceTargetsFromApi, type BaMonthTarget } from './baTargets'
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
  report_json?: EngineReport | null
}

function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { results?: T[] }).results)) {
    return (payload as { results: T[] }).results
  }
  return []
}

/** Pull Django stores and ambassadors into the lists the screens already use. Existing rows stay. */
export async function syncDjango() {
  if (!djangoToken()) return
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

export async function syncBaTargets(month = '2026-09') {
  if (!djangoToken()) return
  try {
    const response = await djangoFetch(`/api/ba-targets/?month=${encodeURIComponent(month)}`)
    if (!response.ok) return
    const payload = (await response.json()) as { results?: BaMonthTarget[] }
    replaceTargetsFromApi(Array.isArray(payload.results) ? payload.results : [])
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
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as ApiAmbassador
  } catch {
    return null
  }
}
