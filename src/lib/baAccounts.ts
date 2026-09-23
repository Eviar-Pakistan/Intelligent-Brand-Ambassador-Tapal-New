import { useSyncExternalStore } from 'react'
import { ambassadors } from '../data/mock'
import type { AnswerMetrics, AssessmentResult } from './baAssessment'

/**
 * Ambassadors Head Office creates. Each one gets a personal account link — there is no
 * email/password sign-in. Opening the link signs that ambassador into their account.
 * A newly created BA can only use Training — video, then verbal assessment — until they
 * are certified; after that the same link opens the full BA app.
 *
 * There is no backend, so accounts and the signed-in session live in this browser's
 * localStorage. Anyone with the link can open that account on this browser.
 */

export type BaStatus = 'Invited' | 'Training' | 'Certified'

export type BaAccount = {
  id: string
  name: string
  city: string
  email: string
  phone: string
  createdAt: string
  status: BaStatus
  videoWatched: boolean
  /** Answers submitted so far (one per assessment question) */
  answers: AnswerMetrics[]
  result: AssessmentResult | null
  /** Secret used in the personal account link. */
  accessToken: string
}

function newAccessToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Sample ambassadors from the Head Office table. Their links stay the same on every device. */
const DEMO_ACCESS_TOKENS: Record<string, string> = {
  ayesha: 'demo-ayesha',
  hamza: 'demo-hamza',
  sara: 'demo-sara',
  fatima: 'demo-fatima',
  bilal: 'demo-bilal',
}

function demoAccountStatus(status: string): BaStatus {
  if (status === 'Certified' || status === 'Deployed') return 'Certified'
  if (status === 'Training') return 'Training'
  return 'Invited'
}

function demoAccounts(): BaAccount[] {
  return ambassadors.map((a) => ({
    id: a.id,
    name: a.name,
    city: a.city,
    email: `${a.id}@tapal.demo`,
    phone: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: demoAccountStatus(a.status),
    videoWatched: a.status !== 'Pending',
    answers: [],
    result: null,
    accessToken: DEMO_ACCESS_TOKENS[a.id] ?? `demo-${a.id}`,
  }))
}

export function isDemoBa(id: string) {
  return ambassadors.some((a) => a.id === id)
}

function withDemoAccounts(list: BaAccount[]): BaAccount[] {
  const ids = new Set(list.map((a) => a.id))
  const missing = demoAccounts().filter((d) => !ids.has(d.id))
  return missing.length ? [...list, ...missing] : list
}

const STORAGE_KEY = 'ba-accounts-v1'
const SESSION_KEY = 'ba-session-v1'

function normalizeAccount(raw: Partial<BaAccount> & { passwordHash?: string }): BaAccount | null {
  if (!raw.id || !raw.name) return null
  return {
    id: raw.id,
    name: raw.name,
    city: raw.city ?? '',
    email: raw.email ?? '',
    phone: raw.phone ?? '',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    status: raw.status ?? 'Invited',
    videoWatched: !!raw.videoWatched,
    answers: Array.isArray(raw.answers) ? raw.answers : [],
    result: raw.result ?? null,
    accessToken: raw.accessToken || newAccessToken(),
  }
}

function load(): BaAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return withDemoAccounts([])
    const list = withDemoAccounts(
      parsed
        .map((item) => normalizeAccount(item as Partial<BaAccount>))
        .filter((a): a is BaAccount => !!a),
    )
    const needsSave =
      list.length !== parsed.length ||
      parsed.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          (!('accessToken' in item) || !item.accessToken || 'passwordHash' in item),
      )
    if (needsSave) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
      } catch {
        // keep the in-memory list
      }
    }
    return list
  } catch {
    return withDemoAccounts([])
  }
}

let accounts = load()
const listeners = new Set<() => void>()

function commit(next: BaAccount[]) {
  accounts = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
  } catch {
    // keep in memory for this session
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // pick up changes made in another tab
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      accounts = load()
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useBaAccounts() {
  return useSyncExternalStore(subscribe, () => accounts)
}

const normEmail = (email: string) => email.trim().toLowerCase()

/** True when another ambassador already uses this email. */
export function baEmailInUse(email: string, exceptId?: string) {
  const e = normEmail(email)
  return !!e && accounts.some((a) => a.id !== exceptId && normEmail(a.email) === e)
}

export type BaAccountFields = { name: string; city: string; email: string; phone: string }

function toAccount(fields: BaAccountFields): BaAccount {
  return {
    id: `ba-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: fields.name.trim(),
    city: fields.city.trim(),
    email: fields.email.trim(),
    phone: fields.phone.trim(),
    createdAt: new Date().toISOString(),
    status: 'Invited',
    videoWatched: false,
    answers: [],
    result: null,
    accessToken: newAccessToken(),
  }
}

export function baAccessPath(token: string) {
  return `/ba/open/${token}`
}

/** Full URL the ambassador opens to enter their account. */
export function baAccessUrl(account: BaAccount) {
  return `${window.location.origin}${baAccessPath(account.accessToken)}`
}

export function findBaByAccessToken(token: string): BaAccount | null {
  return accounts.find((a) => a.accessToken === token) ?? null
}

export function createBaAccount(fields: BaAccountFields): BaAccount {
  const account = toAccount(fields)
  commit([account, ...accounts])
  return account
}

/** Creates many accounts at once, e.g. from a bulk Excel upload. Returns them in input order. */
export function createBaAccounts(fields: BaAccountFields[]): BaAccount[] {
  const added = fields.map(toAccount)
  commit([...added.slice().reverse(), ...accounts])
  return added
}

export function updateBaAccount(id: string, patch: Partial<BaAccount>) {
  commit(accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)))
}

// ─── Signing in (via the personal account link) ─────────────────────────────

const sessionListeners = new Set<() => void>()
let sessionCache: string | null | undefined

function readRaw() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function baSignIn(id: string) {
  try {
    localStorage.setItem(SESSION_KEY, id)
  } catch {
    // ignore
  }
  sessionCache = undefined
  sessionListeners.forEach((l) => l())
}

export function baSignOut() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
  sessionCache = undefined
  sessionListeners.forEach((l) => l())
}

/** Who is signed in to the BA app on this browser (null when nobody is, or the account was deleted). */
export function useBaSession() {
  const list = useBaAccounts()
  const id = useSyncExternalStore(
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
  const account = id ? (list.find((a) => a.id === id) ?? null) : null
  return { account }
}

// ─── Excel template + bulk upload ────────────────────────────────────────────

const SHEET = 'Ambassadors'
const COLUMNS = [
  { key: 'name', header: 'Name *', width: 26 },
  { key: 'city', header: 'City', width: 16 },
  { key: 'email', header: 'Email *', width: 28 },
  { key: 'phone', header: 'Phone', width: 18 },
] as const

/** Downloads the .xlsx a user fills in to create many ambassador accounts at once. */
export async function downloadAmbassadorTemplate() {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([COLUMNS.map((c) => c.header)])
  sheet['!cols'] = COLUMNS.map((c) => ({ wch: c.width }))

  const help = XLSX.utils.aoa_to_sheet([
    ['How to fill the ambassador template'],
    [],
    [`1. Add one ambassador per row on the "${SHEET}" sheet, starting on row 2. Do not change the header row.`],
    ['2. Name and Email are required. City and Phone are optional. There is no password.'],
    ['3. Each ambassador gets a personal account link after creation. They open that link to enter their account.'],
    ['4. An email already used by another ambassador is skipped.'],
    ['5. Save the file, then upload it on the Ambassadors page. Account links can be downloaded after creation.'],
    [],
    COLUMNS.map((c) => c.header),
    ['Ayesha Khan', 'Lahore', 'ayesha.khan@example.com', '0300-1234567'],
  ])
  help['!cols'] = COLUMNS.map((c) => ({ wch: c.width }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, SHEET)
  XLSX.utils.book_append_sheet(wb, help, 'Instructions')
  XLSX.writeFile(wb, 'Tapal_Ambassador_Bulk_Upload_Template.xlsx')
}

export type ParsedAmbassadorRow = { row: number; input: BaAccountFields }
export type AmbassadorParseResult = { rows: ParsedAmbassadorRow[]; errors: string[] }

const headerKey = (h: unknown) => String(h ?? '').replace('*', '').trim().toLowerCase()
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

/** Reads a filled template. Valid rows are returned even when others have problems. */
export async function parseAmbassadorFile(file: File): Promise<AmbassadorParseResult> {
  const XLSX = await import('xlsx')

  let table: unknown[][]
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const name = wb.SheetNames.includes(SHEET) ? SHEET : wb.SheetNames[0]
    table = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true })
  } catch {
    return { rows: [], errors: ['This file could not be read. Please upload the downloaded .xlsx template.'] }
  }

  const headerAt = table.findIndex((r) => r.some((c) => headerKey(c) === 'name'))
  if (headerAt === -1) {
    return {
      rows: [],
      errors: ['This is not the ambassador template (no "Name" column). Download the template and fill that.'],
    }
  }
  const col = new Map<string, number>()
  table[headerAt].forEach((h, i) => col.set(headerKey(h), i))
  const cell = (r: unknown[], header: string) => {
    const v = r[col.get(header) ?? -1]
    return v === undefined || v === null ? '' : String(v).trim()
  }

  const rows: ParsedAmbassadorRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  table.slice(headerAt + 1).forEach((r, i) => {
    const rowNo = headerAt + i + 2
    if (r.every((c) => String(c ?? '').trim() === '')) return

    const name = cell(r, 'name')
    const city = cell(r, 'city')
    const email = cell(r, 'email')
    const phone = cell(r, 'phone')
    const problems: string[] = []
    if (!name) problems.push('Name is required')
    if (!email) problems.push('Email is required')
    else if (!validEmail(email)) problems.push(`Email looks invalid (found "${email}")`)

    if (email) {
      const key = normEmail(email)
      if (seen.has(key)) problems.push('Duplicate of an earlier row in this file')
      else if (baEmailInUse(email)) problems.push('An ambassador with this email already exists')
      seen.add(key)
    }

    if (problems.length > 0) {
      errors.push(`Row ${rowNo}${name ? ` (${name})` : ''}: ${problems.join('; ')}.`)
      return
    }
    rows.push({ row: rowNo, input: { name, city, email, phone } })
  })

  if (rows.length === 0 && errors.length === 0) errors.push('No ambassadors found. Add one per row under the header.')
  return { rows, errors }
}

/** Downloads each ambassador's personal account link. */
export async function downloadBaLinks(list: { name: string; email: string; url: string }[]) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Email', 'Account link'],
    ...list.map((a) => [a.name, a.email, a.url]),
  ])
  sheet['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 56 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Account links')
  XLSX.writeFile(wb, 'Tapal_Ambassador_Account_Links.xlsx')
}
