import { djangoFetch, djangoToken } from './djangoApi'

/**
 * One way to call Django from any screen. Who is asking depends on the part of the app open:
 *   /ba/…          the Brand Ambassador (their personal account-link token)
 *   /supervisor/…  the supervisor (X-Supervisor-Token), or Head Office previewing a supervisor
 *   /shopper/…     a shopper (no sign-in)
 *   anything else  Head Office / admin (the Django JWT)
 */

export type Portal = 'ba' | 'supervisor' | 'shopper' | 'office'

export function currentPortal(): Portal {
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  if (path.startsWith('/ba')) return 'ba'
  if (path.startsWith('/supervisor')) return 'supervisor'
  if (path.startsWith('/shopper')) return 'shopper'
  return 'office'
}

// ─── Supervisor sign-in token ────────────────────────────────────────────────

const SUPERVISOR_TOKEN_KEY = 'supervisor-token'
const SUPERVISOR_SESSION_KEY = 'supervisor-session'

export function supervisorToken() {
  try {
    return localStorage.getItem(SUPERVISOR_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setSupervisorToken(token: string | null) {
  try {
    if (token) localStorage.setItem(SUPERVISOR_TOKEN_KEY, token)
    else localStorage.removeItem(SUPERVISOR_TOKEN_KEY)
  } catch {
    // the portal asks to sign in again
  }
}

function supervisorSession(): { id: string; preview: boolean } | null {
  try {
    const raw = localStorage.getItem(SUPERVISOR_SESSION_KEY)
    return raw ? (JSON.parse(raw) as { id: string; preview: boolean }) : null
  } catch {
    return null
  }
}

// ─── BA token ────────────────────────────────────────────────────────────────

let baTokenSource: () => string | null = () => null

/** baAccounts registers how to read the signed-in BA's link token (avoids an import cycle). */
export function registerBaTokenSource(read: () => string | null) {
  baTokenSource = read
}

/** The signed-in BA's token when it is a real server account (sample accounts have none). */
export function baServerToken() {
  const token = baTokenSource()
  return token && !token.startsWith('demo-') ? token : null
}

// ─── Requests ────────────────────────────────────────────────────────────────

function withParam(path: string, key: string, value: string) {
  const joiner = path.includes('?') ? '&' : '?'
  return `${path}${joiner}${key}=${encodeURIComponent(value)}`
}

/**
 * Fetch with the credentials of whoever is using this part of the app.
 * Returns null when nobody is signed in who could make the request.
 */
export async function portalFetch(path: string, init: RequestInit = {}, portal: Portal = currentPortal()) {
  if (portal === 'ba') {
    const token = baServerToken()
    if (!token) return null
    const headers = new Headers(init.headers)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return fetch(withParam(path, 'token', token), { ...init, headers })
  }
  if (portal === 'supervisor') {
    const session = supervisorSession()
    const token = supervisorToken()
    if (session && !session.preview && token) {
      const headers = new Headers(init.headers)
      headers.set('X-Supervisor-Token', token)
      if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      return fetch(path, { ...init, headers })
    }
    if (session?.preview && djangoToken()) return djangoFetch(withParam(path, 'supervisor', session.id), init)
    return null
  }
  if (portal === 'shopper') {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return fetch(path, { ...init, headers })
  }
  return djangoToken() ? djangoFetch(path, init) : null
}

/** GET and parse JSON. Null when not signed in, offline, or the server refused. */
export async function portalGet<T>(path: string, portal?: Portal): Promise<T | null> {
  try {
    const response = await portalFetch(path, {}, portal)
    if (!response || !response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** Send JSON. Resolves to the parsed body, or throws an Error with the server's message. */
export async function portalSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  portal?: Portal,
): Promise<T | null> {
  const response = await portalFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, portal)
  if (!response) return null
  if (!response.ok) {
    let message = 'The server could not save this.'
    try {
      const data = (await response.json()) as { detail?: string }
      if (data.detail) message = data.detail
    } catch {
      // keep the general message
    }
    throw new Error(message)
  }
  if (response.status === 204) return null
  return (await response.json()) as T
}

/** Results list from `{results: [...]}` payloads. */
export function resultsOf<T>(payload: { results?: T[] } | null): T[] | null {
  return payload && Array.isArray(payload.results) ? payload.results : null
}
