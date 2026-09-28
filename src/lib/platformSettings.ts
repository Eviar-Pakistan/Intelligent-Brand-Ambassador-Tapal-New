import { djangoFetch } from './djangoApi'

export type PlatformSettings = {
  certification_threshold: number
  a_plus_threshold: number
  updated_at?: string
  updated_by_email?: string | null
}

async function parseError(res: Response) {
  try {
    const data = (await res.json()) as { detail?: string; certification_threshold?: string[]; a_plus_threshold?: string[] }
    if (data.detail) return String(data.detail)
    const first = data.certification_threshold?.[0] || data.a_plus_threshold?.[0]
    if (first) return String(first)
  } catch {
    // not JSON
  }
  return 'Could not save the certification score.'
}

export async function fetchPlatformSettings() {
  const res = await djangoFetch('/api/platform-settings/')
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as PlatformSettings
}

export async function updatePlatformSettings(payload: {
  certification_threshold: number
  a_plus_threshold: number
}) {
  const res = await djangoFetch('/api/platform-settings/', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as PlatformSettings
}
