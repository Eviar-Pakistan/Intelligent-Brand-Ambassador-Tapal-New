import { useEffect, useState } from 'react'

const ACCESS_KEY = 'django-access-token'

export type HoRole = 'standard' | 'mis'

export type DjangoUser = {
  id: number
  email: string
  user_type: number
  user_type_label?: string
  /** Head Office sub-role: standard (full UI) or mis (hides Dashboard & Stock) */
  ho_role?: HoRole
  first_name?: string
  last_name?: string
  /** Blank = every city (Head Office); otherwise the one city this login covers */
  city?: string
}

/** MIS shares the Head Office app but cannot use Dashboard or Stock. */
export function isMisUser(user: DjangoUser | null | undefined) {
  return user?.user_type === 1 && user.ho_role === 'mis'
}

/** Landing page after Head Office sign-in (MIS skips Dashboard). */
export function headOfficeHome(user: DjangoUser | null | undefined) {
  return isMisUser(user) ? '/ho/daily-reports' : '/ho/ba-performance'
}

// The signed-in Head Office user, shared by every screen (loaded once per sign-in).
let currentUser: DjangoUser | null = null
let currentUserLoad: Promise<DjangoUser | null> | null = null
const userListeners = new Set<(user: DjangoUser | null) => void>()

function setCurrentUser(user: DjangoUser | null) {
  currentUser = user
  userListeners.forEach((listener) => listener(user))
}

/** The signed-in Head Office user (name, email, city), or null while loading / signed out. */
export function useDjangoUser() {
  const [user, setUser] = useState<DjangoUser | null>(currentUser)
  useEffect(() => {
    userListeners.add(setUser)
    if (!currentUser && djangoToken()) {
      currentUserLoad ??= djangoMe().finally(() => {
        currentUserLoad = null
      })
    }
    return () => {
      userListeners.delete(setUser)
    }
  }, [])
  return user
}

/** "Zoraiz Khan", or the part of the email before @ when no name is set. */
export function displayName(user: DjangoUser) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return full || user.email.split('@')[0]
}

export function djangoToken() {
  try {
    // Kept for the whole browser (every tab), not just this tab. A token from before this change
    // (tab-only storage) is moved over the first time it is read.
    const token = localStorage.getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY)
    if (token && !localStorage.getItem(ACCESS_KEY)) {
      localStorage.setItem(ACCESS_KEY, token)
      sessionStorage.removeItem(ACCESS_KEY)
    }
    return token
  } catch {
    return null
  }
}

export function djangoLogout() {
  try {
    localStorage.removeItem(ACCESS_KEY)
    sessionStorage.removeItem(ACCESS_KEY)
  } catch {
    // the sign-in page is the lock either way
  }
  setCurrentUser(null)
}

export async function djangoMe(): Promise<DjangoUser | null> {
  if (!djangoToken()) return null
  try {
    const response = await djangoFetch('/auth/users/me/')
    if (!response.ok) {
      djangoLogout()
      return null
    }
    const user = (await response.json()) as DjangoUser
    setCurrentUser(user)
    return user
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
    localStorage.setItem(ACCESS_KEY, data.access)
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

export function mirrorComplaint(token: string | undefined, storeId: number, complaint: string) {
  if (!token || token.startsWith('demo-') || !complaint.trim()) return
  void fetch('/api/ba/complaints/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, store_id: storeId, complaint }),
  }).catch(() => undefined)
}
