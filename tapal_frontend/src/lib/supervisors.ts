import { useSyncExternalStore } from 'react'
import { ambassadors, baRanking, stores, type Store } from '../data/mock'
import { djangoToken } from './djangoApi'
import { currentPortal, portalGet, portalSend, resultsOf, setSupervisorToken, supervisorToken } from './serverApi'
import { sha256Hex } from './sha256'
import { upsertApiStores, type ApiStoreRow } from './storeRegistry'

/**
 * Supervisors oversee a set of stores. Head Office creates them (with a login) and assigns
 * stores; a supervisor signs in and sees the BAs and characteristics of those stores only.
 *
 * Supervisors, their stores and their sign-in are kept on the server (/api/supervisors/,
 * /api/supervisor/login/). This list mirrors the server so screens can read it directly;
 * the password itself never reaches the browser.
 */

export type Supervisor = {
  id: string
  name: string
  phone: string
  /** Also the sign-in name */
  email: string
  city: string
  storeIds: number[]
  createdAt: string
  passwordSalt: string
  /** sha256(`${salt}:${password}`); empty when no password has been set yet */
  passwordHash: string
}

const STORAGE_KEY = 'supervisors-v2'
const LEGACY_KEY = 'supervisors-v1'
const SESSION_KEY = 'supervisor-session'

export const hashPassword = (salt: string, password: string) => sha256Hex(`${salt}:${password}`)

/** Supervisors come from the server; nothing is built in. */
const seed: Supervisor[] = []

function read(key: string): Partial<Supervisor>[] | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function load(): Supervisor[] {
  // supervisors made before sign-in existed carry over, without a password until Head Office sets one
  const stored = read(STORAGE_KEY) ?? read(LEGACY_KEY)
  if (!stored) return seed
  return stored.map((s) => ({
    id: s.id ?? `sup-${Math.random().toString(36).slice(2, 8)}`,
    name: s.name ?? 'Supervisor',
    phone: s.phone ?? '',
    email: s.email ?? '',
    city: s.city ?? '',
    storeIds: s.storeIds ?? [],
    createdAt: s.createdAt ?? new Date().toISOString(),
    passwordSalt: s.passwordSalt ?? '',
    passwordHash: s.passwordHash ?? '',
  }))
}

let supervisors = load()
const listeners = new Set<() => void>()

function commit(next: Supervisor[]) {
  supervisors = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(supervisors))
  } catch {
    // keep in memory for this session
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSupervisors() {
  return useSyncExternalStore(subscribe, () => supervisors)
}

export function getSupervisors() {
  return supervisors
}

// ─── Server ──────────────────────────────────────────────────────────────────

function replaceOne(next: Supervisor) {
  commit([next, ...supervisors.filter((s) => s.id !== next.id)])
}

function sendToServer(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  if (!djangoToken()) return Promise.resolve(null)
  return portalSend<Supervisor>(path, method, body, 'office').catch((error) => {
    console.warn('[supervisors] not saved on the server:', error instanceof Error ? error.message : error)
    return null
  })
}

/**
 * Loads supervisors from the server. Head Office gets everyone (and any supervisor made in this
 * browser before the server kept them is carried over, without a password); a signed-in
 * supervisor gets themselves.
 */
export async function syncSupervisors() {
  if (currentPortal() === 'supervisor') {
    const me = await portalGet<{ supervisor: Supervisor }>('/api/supervisor/me/', 'supervisor')
    if (!me?.supervisor) return
    replaceOne(me.supervisor)
    await syncSupervisorOverview(me.supervisor.id)
    return
  }
  if (!djangoToken()) return
  const list = resultsOf(await portalGet<{ results: Supervisor[] }>('/api/supervisors/', 'office'))
  if (!list) return
  const ids = new Set(list.map((s) => s.id))
  const emails = new Set(list.map((s) => normEmail(s.email)))
  for (const local of supervisors) {
    if (ids.has(local.id) || !local.email || emails.has(normEmail(local.email))) continue
    const { id, name, phone, email, city, storeIds } = local
    const saved = await sendToServer('/api/supervisors/', 'POST', { id, name, phone, email, city, storeIds })
    if (saved) list.push(saved)
  }
  commit(list)
  await Promise.all(list.map((s) => syncSupervisorOverview(s.id)))
}

/** A store belongs to one supervisor, so assigning it here takes it from anyone else. */
function withStoresAssigned(list: Supervisor[], supervisorId: string, storeIds: number[]) {
  return list.map((s) =>
    s.id === supervisorId
      ? { ...s, storeIds }
      : { ...s, storeIds: s.storeIds.filter((id) => !storeIds.includes(id)) },
  )
}

const normEmail = (email: string) => email.trim().toLowerCase()

/** True when another supervisor already signs in with this email. */
export function emailInUse(email: string, exceptId?: string) {
  const e = normEmail(email)
  return supervisors.some((s) => s.id !== exceptId && normEmail(s.email) === e)
}

function newCredentials(password: string) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
  return { passwordSalt: salt, passwordHash: hashPassword(salt, password) }
}

/** A readable password: no look-alike characters (0/O, 1/l/I). */
export function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => chars[b % chars.length]).join('')
}

export function createSupervisor(
  fields: { name: string; phone: string; email: string; city: string; password: string },
  storeIds: number[],
): Supervisor {
  const supervisor: Supervisor = {
    id: `sup-${Date.now().toString(36)}`,
    name: fields.name.trim(),
    phone: fields.phone.trim(),
    email: fields.email.trim(),
    city: fields.city.trim(),
    storeIds: [],
    createdAt: new Date().toISOString(),
    ...newCredentials(fields.password),
  }
  commit(withStoresAssigned([supervisor, ...supervisors], supervisor.id, storeIds))
  const { id, name, phone, email, city } = supervisor
  void sendToServer('/api/supervisors/', 'POST', { id, name, phone, email, city, storeIds, password: fields.password }).then(
    (saved) => {
      if (!saved) return
      replaceOne(saved)
      void syncSupervisors()
    },
  )
  return { ...supervisor, storeIds }
}

/** Sets (or resets) the email and password a supervisor signs in with. */
export function setLogin(supervisorId: string, email: string, password: string) {
  commit(
    supervisors.map((s) => (s.id === supervisorId ? { ...s, email: email.trim(), ...newCredentials(password) } : s)),
  )
  void sendToServer(`/api/supervisors/${encodeURIComponent(supervisorId)}/`, 'PATCH', {
    email: email.trim(),
    password,
  }).then((saved) => saved && replaceOne(saved))
}

export function assignStores(supervisorId: string, storeIds: number[]) {
  commit(withStoresAssigned(supervisors, supervisorId, storeIds))
  void sendToServer(`/api/supervisors/${encodeURIComponent(supervisorId)}/`, 'PATCH', { storeIds }).then(() =>
    syncSupervisors(),
  )
}

export function deleteSupervisor(supervisorId: string) {
  commit(supervisors.filter((s) => s.id !== supervisorId))
  overviewCache.delete(supervisorId)
  void sendToServer(`/api/supervisors/${encodeURIComponent(supervisorId)}/`, 'DELETE')
  if (readSession()?.id === supervisorId) signOut()
}

export function supervisorOfStore(storeId: number) {
  return supervisors.find((s) => s.storeIds.includes(storeId)) ?? null
}

// ─── Signing in ──────────────────────────────────────────────────────────────

/** Checks the email and password on the server. Keeps the sign-in token; returns the supervisor, or null. */
export async function authenticate(email: string, password: string): Promise<Supervisor | null> {
  try {
    const response = await fetch('/api/supervisor/login/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { token: string; supervisor: Supervisor }
    setSupervisorToken(data.token)
    replaceOne(data.supervisor)
    return data.supervisor
  } catch {
    return null
  }
}

/** `preview` = Head Office looking at the portal as this supervisor, without their password. */
export type SupervisorSession = { id: string; preview: boolean }

const sessionListeners = new Set<() => void>()
let sessionCache: string | null | undefined

function readRaw() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function readSession(): SupervisorSession | null {
  try {
    const raw = readRaw()
    return raw ? (JSON.parse(raw) as SupervisorSession) : null
  } catch {
    return null
  }
}

export function signIn(id: string, preview = false) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, preview } satisfies SupervisorSession))
  } catch {
    // ignore
  }
  sessionCache = undefined
  sessionListeners.forEach((l) => l())
}

export function signOut() {
  const token = supervisorToken()
  if (token) {
    void fetch('/api/supervisor/logout/', { method: 'POST', headers: { 'X-Supervisor-Token': token } }).catch(
      () => undefined,
    )
  }
  setSupervisorToken(null)
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
  sessionCache = undefined
  sessionListeners.forEach((l) => l())
}

/** Who is signed in to the supervisor portal (null when nobody is, or the account was deleted). */
export function useSupervisorSession() {
  const list = useSupervisors()
  const raw = useSyncExternalStore(
    (l) => {
      sessionListeners.add(l)
      window.addEventListener('storage', l)
      return () => {
        sessionListeners.delete(l)
        window.removeEventListener('storage', l)
      }
    },
    () => (sessionCache === undefined ? (sessionCache = readRaw()) : sessionCache),
  )
  let session: SupervisorSession | null = null
  try {
    session = raw ? (JSON.parse(raw) as SupervisorSession) : null
  } catch {
    session = null
  }
  const supervisor = session ? (list.find((s) => s.id === session.id) ?? null) : null
  return { supervisor, preview: !!session?.preview }
}

// ─── What a supervisor sees ──────────────────────────────────────────────────

export type SupervisorBa = {
  id: string
  name: string
  storeId: number
  store: string
  state: 'Active' | 'Break' | 'Offline'
  conversion: number
  points: number
  sessions: number
  score: number
}

export type SupervisorOverview = {
  stores: Store[]
  bas: SupervisorBa[]
  /** Average conversion of the BAs in these stores, % */
  teamConversion: number
  /** Average coverage of these stores, % */
  coverage: number
  todayFootfall: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

type ApiOverview = {
  stores: ApiStoreRow[]
  bas: SupervisorBa[]
  teamConversion: number
  coverage: number
  todayFootfall: number
}

const overviewCache = new Map<string, SupervisorOverview>()

/**
 * Loads a supervisor's stores, their BAs today and the headline numbers from the server.
 * Screens keep calling `supervisorOverview()`; it returns this once loaded.
 */
export async function syncSupervisorOverview(supervisorId: string) {
  const portal = currentPortal() === 'supervisor' ? 'supervisor' : 'office'
  const path =
    portal === 'supervisor'
      ? '/api/supervisor/overview/'
      : `/api/supervisor/overview/?supervisor=${encodeURIComponent(supervisorId)}`
  const data = await portalGet<ApiOverview>(path, portal)
  if (!data) return
  upsertApiStores(data.stores)
  const ids = new Set(data.stores.map((row) => row.id))
  overviewCache.set(supervisorId, {
    stores: stores.filter((store) => ids.has(store.id)),
    bas: data.bas,
    teamConversion: data.teamConversion,
    coverage: data.coverage,
    todayFootfall: data.todayFootfall,
  })
  commit([...supervisors])
}

/** The stores assigned to a supervisor, the BAs working in them, and their headline numbers. */
export function supervisorOverview(supervisor: Supervisor): SupervisorOverview {
  const loaded = overviewCache.get(supervisor.id)
  if (loaded) return loaded
  return localOverview(supervisor)
}

function localOverview(supervisor: Supervisor): SupervisorOverview {
  const mine = stores.filter((s) => supervisor.storeIds.includes(s.id))

  const bas: SupervisorBa[] = mine.flatMap((store) =>
    store.assigned.map((a) => {
      const ranked = baRanking.find((b) => b.id === a.id)
      const profile = ambassadors.find((p) => p.id === a.id)
      return {
        id: a.id,
        name: a.name,
        storeId: store.id,
        store: store.name,
        state: a.state,
        conversion: ranked?.conversion ?? profile?.today.rate ?? 0,
        points: ranked?.points ?? profile?.points ?? 0,
        sessions: profile?.today.interactions ?? 0,
        score: profile?.score ?? 0,
      }
    }),
  )

  const uniqueBas = new Map(bas.map((b) => [b.id, b]))
  return {
    stores: mine,
    bas,
    teamConversion: Math.round(mean([...uniqueBas.values()].map((b) => b.conversion)) * 10) / 10,
    coverage: Math.round(mean(mine.map((s) => s.coverage)) * 10) / 10,
    todayFootfall: mine.reduce((s, x) => s + x.todayFootfall, 0),
  }
}
