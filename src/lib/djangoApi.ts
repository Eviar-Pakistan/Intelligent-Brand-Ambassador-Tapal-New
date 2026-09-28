const ACCESS_KEY = 'django-access-token'

export type DjangoUser = {
  id: number
  email: string
  user_type: number
  user_type_label?: string
}

export function djangoToken() {
  try {
    return sessionStorage.getItem(ACCESS_KEY)
  } catch {
    return null
  }
}

export function djangoLogout() {
  try {
    sessionStorage.removeItem(ACCESS_KEY)
  } catch {
    // the sign-in page is the lock either way
  }
}

export async function djangoMe(): Promise<DjangoUser | null> {
  if (!djangoToken()) return null
  try {
    const response = await djangoFetch('/auth/users/me/')
    if (!response.ok) {
      djangoLogout()
      return null
    }
    return (await response.json()) as DjangoUser
  } catch {
    return null
  }
}

/** Head Office is user type 1. Any other account is rejected and the token is dropped. */
export async function djangoLogin(email: string, password: string) {
  const trimmed = email.trim()
  if (!trimmed || !password) return { ok: false as const, error: 'Enter your email and password.' }
  try {
    const response = await fetch('/auth/jwt/create/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmed, password }),
    })
    if (!response.ok) return { ok: false as const, error: 'Incorrect email or password.' }
    const data = (await response.json()) as { access?: string }
    if (!data.access) return { ok: false as const, error: 'Incorrect email or password.' }
    sessionStorage.setItem(ACCESS_KEY, data.access)
    const me = await djangoMe()
    if (!me) return { ok: false as const, error: 'Could not confirm this account.' }
    if (me.user_type !== 1) {
      djangoLogout()
      return { ok: false as const, error: 'This sign-in is for Head Office only.' }
    }
    return { ok: true as const, user: me }
  } catch {
    djangoLogout()
    return { ok: false as const, error: 'The server is not available. Start it, then try again.' }
  }
}

export async function djangoFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const token = djangoToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(path, { ...init, headers })
}

/**
 * Check-in stays instant in the app; this also tells Django when the BA has a real invite token.
 * Check-out is not here: it is sent with the report (BaShiftContext.submitCheckoutReport).
 */
export function mirrorCheckIn(token: string | undefined) {
  if (!token || token.startsWith('demo-')) return
  void fetch('/api/ba/check-in/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => undefined)
}

export function mirrorComplaint(token: string | undefined, storeId: number, complaint: string) {
  if (!token || token.startsWith('demo-') || !complaint.trim()) return
  void fetch('/api/ba/complaints/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, store_id: storeId, complaint }),
  }).catch(() => undefined)
}
