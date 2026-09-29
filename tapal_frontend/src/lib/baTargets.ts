import { useSyncExternalStore } from 'react'
import { djangoFetch, djangoToken } from './djangoApi'

/** One SKU of a store target. qty is kg; from the store SKU sheet also brand, grammage (kg per pack) and packs. */
export type TargetLine = {
  sku: string
  qty: number
  brand?: string
  grammage?: number
  count?: number | null
  /** Sales kg for this SKU, when recorded */
  sales?: number | null
}

export type BaMonthTarget = {
  baId: string
  baName: string
  baCode?: string
  storeName?: string
  storeCode?: string
  city?: string
  /** YYYY-MM */
  month: string
  /** Sum of the September SKU quantities for this store. */
  targetKg: number
  salesKg: number
  lines?: TargetLine[]
}

const STORAGE_KEY = 'ba-month-targets-v1'

const seed: BaMonthTarget[] = []

const SAMPLE_BA_IDS = new Set(['ayesha', 'hamza', 'sara', 'fatima', 'bilal'])

function load(): BaMonthTarget[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return seed
    const stored = parsed.filter(
      (row): row is BaMonthTarget =>
        !!row &&
        typeof row.baId === 'string' &&
        typeof row.month === 'string' &&
        typeof row.targetKg === 'number' &&
        typeof row.salesKg === 'number' &&
        !SAMPLE_BA_IDS.has(row.baId),
    )
    const keys = new Set(stored.map((row) => `${row.baId}:${row.month}`))
    return [...stored, ...seed.filter((row) => !keys.has(`${row.baId}:${row.month}`))]
  } catch {
    return seed
  }
}

let targets = load()
const listeners = new Set<() => void>()

function commit(next: BaMonthTarget[]) {
  targets = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(targets))
  } catch {
    // keep the in-memory list
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBaTargets() {
  return useSyncExternalStore(subscribe, () => targets, () => seed)
}

export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function formatTargetMonth(month: string) {
  const [year, mon] = month.split('-')
  const index = Number(mon) - 1
  const name = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][index]
  return name ? `${name} ${year}` : month
}

export function achievementPct(targetKg: number, salesKg: number) {
  if (targetKg <= 0) return 0
  return Math.round((salesKg / targetKg) * 100)
}

export function setBaMonthTarget(input: BaMonthTarget) {
  const next = targets.filter((row) => !(row.baId === input.baId && row.month === input.month))
  commit([{ ...input, baName: input.baName.trim() }, ...next])
}

/** Replaces each ambassador-month in one save. */
/** Replaces the saved list with the rows returned by the API. */
export function replaceTargetsFromApi(rows: BaMonthTarget[]) {
  commit(
    rows
      .filter(
        (row) =>
          !!row &&
          typeof row.baId === 'string' &&
          typeof row.month === 'string' &&
          typeof row.targetKg === 'number' &&
          !SAMPLE_BA_IDS.has(row.baId),
      )
      .map((row) => ({
        ...row,
        baName: row.baName.trim(),
        salesKg: typeof row.salesKg === 'number' ? row.salesKg : 0,
        lines: Array.isArray(row.lines) ? row.lines : [],
      })),
  )
}

export function setBaMonthTargets(rows: BaMonthTarget[]) {
  if (rows.length === 0) return
  const keys = new Set(rows.map((row) => `${row.baId}:${row.month}`))
  const kept = targets.filter((row) => !keys.has(`${row.baId}:${row.month}`))
  commit([...rows.map((row) => ({ ...row, baName: row.baName.trim() })), ...kept])
}

export type TargetPerson = { id: string; name: string; baCode?: string }

const TARGET_SHEET = 'Targets'

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/**
 * Downloads the target template for a month: every BA (by BA Code) x every SKU, with the
 * targets already saved for that month filled in. Built on the server.
 */
export async function downloadTargetTemplate(month = currentMonthKey()) {
  if (!djangoToken()) throw new Error('Sign in to Head Office to download the template.')
  const response = await djangoFetch(`/api/ba-targets/template/?month=${encodeURIComponent(month)}`)
  if (!response.ok) throw new Error('The template could not be downloaded.')
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = `Tapal_BA_Target_Template_${month}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export type TargetParseResult = { rows: BaMonthTarget[]; errors: string[] }

const targetHeaderKey = (value: unknown) => String(value ?? '').replace(/\*/g, '').trim().toLowerCase()

export function parseMonthCell(value: unknown, parseDateCode: (value: number) => { y: number; m: number } | null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = parseDateCode(value)
    if (parsed?.y && parsed.m >= 1 && parsed.m <= 12) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}`
    }
  }
  const text = String(value ?? '').trim()
  const iso = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(text)
  if (iso) {
    const month = Number(iso[2])
    if (month >= 1 && month <= 12) return `${iso[1]}-${String(month).padStart(2, '0')}`
  }
  const named = /^([A-Za-z]+)\s+(\d{4})$/.exec(text)
  if (named) {
    const index = MONTH_NAMES.findIndex((name) => name.startsWith(named[1].toLowerCase().slice(0, 3)))
    if (index >= 0) return `${named[2]}-${String(index + 1).padStart(2, '0')}`
  }
  return null
}

function parseKg(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim().replace(/,/g, '')
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}


/**
 * Reads a filled target template: one row per BA per SKU (BA Code, Month, Brand, SKU Name, Target Kg,
 * Sales Kg, Grammage). Rows are grouped so each BA gets all their SKU targets for the month.
 * Valid BAs are returned even when other rows have problems.
 */
export async function parseTargetFile(file: File, people: TargetPerson[]): Promise<TargetParseResult> {
  const XLSX = await import('xlsx')
  let table: unknown[][]
  try {
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
    const name = book.SheetNames.includes(TARGET_SHEET) ? TARGET_SHEET : book.SheetNames[0]
    table = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: true })
  } catch {
    return { rows: [], errors: ['This file could not be read. Please upload the downloaded .xlsx template.'] }
  }

  const headerAt = table.findIndex((row) => row.some((cell) => targetHeaderKey(cell) === 'ba code'))
  if (headerAt === -1) {
    return { rows: [], errors: ['This is not the target template (no "BA Code" column). Download the template and fill that.'] }
  }
  const columns = new Map<string, number>()
  table[headerAt].forEach((header, index) => columns.set(targetHeaderKey(header), index))
  const skuColumn = columns.has('sku name') ? 'sku name' : 'sku'
  if (!columns.has('target kg') || !columns.has('month') || !columns.has(skuColumn)) {
    return { rows: [], errors: ['The template needs BA Code, Month, SKU Name and Target Kg columns. Download a fresh template.'] }
  }

  const cell = (row: unknown[], header: string) => row[columns.get(header) ?? -1]
  const byCode = new Map(
    people.filter((p) => p.baCode).map((person) => [person.baCode!.trim().toUpperCase(), person] as const),
  )

  const grouped = new Map<string, BaMonthTarget>()
  const errors: string[] = []
  const seenSku = new Set<string>()

  table.slice(headerAt + 1).forEach((row, index) => {
    const rowNo = headerAt + index + 2
    if (row.every((value) => String(value ?? '').trim() === '')) return
    const code = String(cell(row, 'ba code') ?? '').trim().toUpperCase()
    const sku = String(cell(row, skuColumn) ?? '').trim()
    const month = parseMonthCell(cell(row, 'month'), (value) => XLSX.SSF.parse_date_code(value))
    const target = parseKg(cell(row, 'target kg'))
    const sales = parseKg(columns.has('sales kg') ? cell(row, 'sales kg') : '')
    if (target === null) return // no target on this SKU: skipped

    const problems: string[] = []
    if (!code) problems.push('BA Code is required')
    if (!sku) problems.push('SKU Name is required')
    if (!month) problems.push('Month must be YYYY-MM, for example 2026-09')
    if (target < 0) problems.push('Target Kg cannot be negative')
    if (sales !== null && sales < 0) problems.push('Sales Kg cannot be negative')
    const person = code ? byCode.get(code) : undefined
    if (code && !person) problems.push(`No ambassador with BA code ${code}`)
    const skuKey = `${code}:${month}:${sku.toLowerCase()}`
    if (code && sku && month && seenSku.has(skuKey)) problems.push('This SKU is already listed for this BA and month')
    seenSku.add(skuKey)

    if (problems.length > 0) {
      errors.push(`Row ${rowNo}${code ? ` (${code}${sku ? ` · ${sku}` : ''})` : ''}: ${problems.join('; ')}.`)
      return
    }
    if (!person || !month) return
    const key = `${person.id}:${month}`
    const entry =
      grouped.get(key) ??
      ({ baId: person.id, baName: person.name, baCode: code, month, targetKg: 0, salesKg: 0, lines: [] } as BaMonthTarget)
    const grammage = parseKg(columns.has('grammage') ? cell(row, 'grammage') : '')
    entry.lines!.push({
      sku,
      brand: String(columns.has('brand') ? (cell(row, 'brand') ?? '') : '').trim(),
      qty: target,
      sales,
      grammage: grammage ?? undefined,
      count: grammage ? Math.round((target / grammage) * 100) / 100 : null,
    })
    entry.targetKg = Math.round((entry.targetKg + target) * 100) / 100
    entry.salesKg = Math.round((entry.salesKg + (sales ?? 0)) * 100) / 100
    grouped.set(key, entry)
  })

  const rows = [...grouped.values()]
  if (rows.length === 0 && errors.length === 0) {
    errors.push('No targets found. Enter Target Kg on the SKU rows you want to save.')
  }
  return { rows, errors }
}

/** Saves SKU targets per BA on the server, then reloads them. Returns what the server saved and skipped. */
export async function saveBaTargetsToServer(rows: BaMonthTarget[]) {
  if (!djangoToken()) throw new Error('Sign in to Head Office to save targets.')
  const response = await djangoFetch('/api/ba-targets/', {
    method: 'POST',
    body: JSON.stringify({
      rows: rows.map((row) => ({
        baCode: row.baCode,
        month: row.month,
        lines: (row.lines ?? []).map(({ sku, brand, qty, sales, grammage }) => ({ sku, brand, qty, sales, grammage })),
      })),
    }),
  })
  const data = (await response.json().catch(() => ({}))) as {
    saved?: { baCode: string; month: string }[]
    errors?: string[]
    detail?: string
  }
  if (!response.ok && !data.saved?.length) throw new Error(data.errors?.[0] || data.detail || 'The targets could not be saved.')
  const { syncBaTargets } = await import('./djangoSync')
  for (const month of new Set(rows.map((row) => row.month))) await syncBaTargets(month)
  return { saved: data.saved ?? [], errors: data.errors ?? [] }
}

export function targetForBa(baId: string, month: string, list: BaMonthTarget[]) {
  return list.find((row) => row.baId === baId && row.month === month) ?? null
}
