import { registerBaTokenSource } from './serverApi'
import { useSyncExternalStore } from 'react'
import { ambassadors } from '../data/mock'
import { analysisFromReport, type EngineReport } from './trainingApi'
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
  /** Unique code assigned by the server, for example BA-4K7M2Q. */
  baCode: string
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
  /** Store this ambassador is assigned to, when one has been set. */
  storeName?: string
  storeId?: number | null
  /** Server lifecycle status: Pending, Training, Assessed, Certified, Rejected, Deployed */
  serverStatus?: string
  /** False when Head Office deactivated this BA */
  isActive?: boolean
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
    baCode: '',
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

function withoutDemoAccounts(list: BaAccount[]): BaAccount[] {
  const demoIds = new Set(demoAccounts().map((account) => account.id))
  return list.filter((account) => !demoIds.has(account.id))
}

const STORAGE_KEY = 'ba-accounts-v1'
/** One-time: ambassadors who never answered still start on the training video. */
const VIDEO_FIRST_KEY = 'ba-video-before-questions-v1'
const SESSION_KEY = 'ba-session-v1'

function normalizeAccount(raw: Partial<BaAccount> & { passwordHash?: string }): BaAccount | null {
  if (!raw.id || !raw.name) return null
  return {
    id: raw.id,
    baCode: raw.baCode ?? '',
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
    if (!Array.isArray(parsed)) return []
    let list = withoutDemoAccounts(
      parsed
        .map((item) => normalizeAccount(item as Partial<BaAccount>))
        .filter((a): a is BaAccount => !!a),
    ).filter((account) => account.baCode)
    let videoFirst = false
    try {
      videoFirst = localStorage.getItem(VIDEO_FIRST_KEY) === '1'
    } catch {
      videoFirst = true
    }
    if (!videoFirst) {
      list = list.map((account) =>
        account.answers.length === 0 && !account.result ? { ...account, videoWatched: false } : account,
      )
      try {
        localStorage.setItem(VIDEO_FIRST_KEY, '1')
      } catch {
        // the in-memory list still starts on the video
      }
    }
    const needsSave =
      !videoFirst ||
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
    return []
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
    baCode: '',
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

function uiStatus(status: string | undefined): BaStatus {
  if (status === 'Certified' || status === 'Deployed' || status === 'Assessed') return 'Certified'
  if (status === 'Training' || status === 'Rejected') return 'Training'
  return 'Invited'
}

/** Add a Django ambassador to the account list. An ambassador already stored by email or link is kept. */
export function adoptApiAmbassador(row: {
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
}): BaAccount | null {
  if (!row?.id || !row.name) return null
  const email = (row.email ?? '').trim()
  const token = row.invite_token || ''
  const existing = accounts.find(
    (account) =>
      (email && normEmail(account.email) === normEmail(email)) || (token && account.accessToken === token),
  )
  const saved = analysisFromReport(row.report_json)
  if (saved && (row.status === 'Certified' || row.status === 'Deployed')) saved.result.certified = true
  if (existing) {
    const next: BaAccount = {
      ...existing,
      id: `api-${row.id}`,
      baCode: row.ba_code || existing.baCode,
      storeName: row.store_name || existing.storeName || '',
      accessToken: token || existing.accessToken,
      status: saved?.result.certified ? 'Certified' : existing.status,
      videoWatched: existing.videoWatched || !!saved,
      answers: saved?.answers.length ? saved.answers : existing.answers,
      result: saved?.result ?? existing.result,
    }
    commit(accounts.map((account) => (account.id === existing.id ? next : account)))
    return next
  }
  const account: BaAccount = {
    id: `api-${row.id}`,
    baCode: row.ba_code || '',
    name: row.name,
    city: row.city || '',
    email,
    phone: row.phone || '',
    storeName: row.store_name || '',
    createdAt: row.created_at || new Date().toISOString(),
    status: uiStatus(row.status),
    videoWatched: !!saved,
    answers: saved?.answers ?? [],
    result: saved?.result ?? null,
    accessToken: token || `api-${row.id}`,
  }
  if (saved?.result.certified) account.status = 'Certified'
  commit([account, ...accounts])
  return account
}

/** The server roster replaces the list, so deleted ambassadors disappear. */
export function replaceAmbassadorsFromApi(rows: Parameters<typeof adoptApiAmbassador>[0][]) {
  const next: BaAccount[] = []
  for (const row of rows) {
    if (!row?.id || !row.name) continue
    const id = `api-${row.id}`
    const token = row.invite_token || ''
    const existing = accounts.find((account) => account.id === id || (token && account.accessToken === token))
    const status = uiStatus(row.status)
    const saved = analysisFromReport(row.report_json)
    if (saved && (row.status === 'Certified' || row.status === 'Deployed')) saved.result.certified = true
    next.push({
      id,
      baCode: row.ba_code || existing?.baCode || '',
      name: row.name,
      city: row.city || '',
      email: (row.email ?? '').trim(),
      phone: row.phone || '',
      storeName: row.store_name || '',
      storeId: row.store ?? null,
      serverStatus: row.status,
      isActive: row.is_active !== false,
      createdAt: row.created_at || existing?.createdAt || new Date().toISOString(),
      status: saved?.result.certified ? 'Certified' : status,
      videoWatched: existing?.videoWatched || !!saved,
      answers: saved?.answers.length ? saved.answers : existing?.answers ?? [],
      result: saved?.result ?? existing?.result ?? null,
      accessToken: token || existing?.accessToken || id,
    })
  }
  commit(next)
}

/** Opening the account link starts on the video until the ambassador has submitted an answer. */
function beginAtVideo(account: BaAccount | null): BaAccount | null {
  if (!account || account.result || account.answers.length > 0 || !account.videoWatched) return account
  const next = { ...account, videoWatched: false }
  commit(accounts.map((item) => (item.id === account.id ? next : item)))
  return next
}

export async function resolveBaAccessToken(token: string): Promise<BaAccount | null> {
  const local = findBaByAccessToken(token)
  try {
    const response = await fetch(`/api/ba/invite/${encodeURIComponent(token)}/`)
    if (!response.ok) return beginAtVideo(local)
    const data = (await response.json()) as { ambassador?: Parameters<typeof adoptApiAmbassador>[0] }
    return beginAtVideo(data.ambassador ? adoptApiAmbassador(data.ambassador) : local)
  } catch {
    return beginAtVideo(local)
  }
}

export async function createBaAccount(fields: BaAccountFields): Promise<BaAccount> {
  const account = toAccount(fields)
  const { pushAmbassador } = await import('./djangoSync')
  const remote = await pushAmbassador(account)
  if (!remote?.invite_token || !remote.ba_code || remote.id == null) {
    throw new Error(
      'Sign out, then sign in with headoffice@tapaltea.com and HeadOffice@123. The link is saved on the server so it opens in another browser.',
    )
  }
  account.id = `api-${remote.id}`
  account.baCode = remote.ba_code
  account.accessToken = remote.invite_token
  commit([account, ...accounts])
  return account
}

/** Creates many accounts at once, e.g. from a bulk Excel upload. Returns them in input order. */
export async function createBaAccounts(fields: BaAccountFields[]): Promise<BaAccount[]> {
  const added: BaAccount[] = []
  for (const field of fields) added.push(await createBaAccount(field))
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

registerBaTokenSource(() => {
  const id = readRaw()
  return id ? (accounts.find((account) => account.id === id)?.accessToken ?? null) : null
})

/** Id of the BA signed in on this device (null when nobody is). */
export function currentBaAccountId() {
  return readRaw()
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
  { key: 'email', header: 'Email', width: 28 },
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
    ['2. Only Name is required. City, Email and Phone are optional. There is no password.'],
    ['3. Each ambassador gets a personal account link after creation. They open that link to enter their account.'],
    ['4. If you enter an email, it must be valid and not already used by another ambassador.'],
    ['5. Save the file, then upload it on the Ambassadors page. Account links can be downloaded after creation.'],
    [],
    COLUMNS.map((c) => c.header),
    ['Example Name', 'Lahore', 'name@example.com', '0300-0000000'],
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
    if (email && !validEmail(email)) problems.push(`Email looks invalid (found "${email}")`)

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
export async function downloadBaLinks(list: { name: string; email: string; code: string; url: string }[]) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Email', 'BA code', 'Account link'],
    ...list.map((a) => [a.name, a.email, a.code, a.url]),
  ])
  sheet['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 14 }, { wch: 56 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Account links')
  XLSX.writeFile(wb, 'Tapal_Ambassador_Account_Links.xlsx')
}
