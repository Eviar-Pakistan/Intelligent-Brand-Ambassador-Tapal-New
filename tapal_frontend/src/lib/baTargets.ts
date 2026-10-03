import { useSyncExternalStore } from 'react'
import { djangoFetch, djangoToken } from './djangoApi'
import { loadSkuCatalogue } from './skuCatalogue'

/** One SKU of a store target. kg is the target in kg and unit the packs; also brand and grammage (kg per pack). */
export type TargetLine = {
  sku: string
  kg: number
  brand?: string
  grammage?: number
  unit?: number | null
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
  /** Sum of the SKU target quantities (kg) for the month. */
  targetKg: number
  salesKg: number
  lines?: TargetLine[]
}

const STORAGE_KEY = 'ba-month-targets-v1'

const seed: BaMonthTarget[] = []

/** Older saved rows named the SKU target `qty` and the packs `count`; they are now `kg` and `unit`. */
function normalizeLines(lines: unknown): TargetLine[] {
  if (!Array.isArray(lines)) return []
  return lines.map((raw) => {
    const { qty, count, ...rest } = raw as TargetLine & { qty?: number; count?: number | null }
    return { ...rest, kg: rest.kg ?? qty ?? 0, unit: rest.unit ?? count ?? null }
  })
}

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
    return [...stored.map((row) => ({ ...row, lines: normalizeLines(row.lines) })), ...seed.filter((row) => !keys.has(`${row.baId}:${row.month}`))]
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

/** A SKU target's real kg, cleaned to 2 decimals (Excel formulas give 0.6000000000000001). */
export function kg2(value: number) {
  return Math.round(value * 100) / 100
}

/** How a target is shown: whole kg, the way Excel shows the cell (0.6 -> 1, 23.8 -> 24). */
export function shownKg(value: number) {
  return Math.round(Number(value.toPrecision(12)))
}

export function achievementPct(targetKg: number, salesKg: number) {
  if (targetKg <= 0) return 0
  return Math.round((salesKg / targetKg) * 100)
}

export function setBaMonthTarget(input: BaMonthTarget) {
  const next = targets.filter((row) => !(row.baId === input.baId && row.month === input.month))
  commit([{ ...input, baName: input.baName.trim() }, ...next])
}

/** Replaces that month's targets with the rows returned by the API (other months are kept). */
export function replaceTargetsFromApi(rows: BaMonthTarget[], month?: string) {
  const kept = month ? targets.filter((row) => row.month !== month) : []
  commit([
    ...rows
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
        lines: normalizeLines(row.lines),
      })),
    ...kept,
  ])
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
 * Reads a filled target template: one row per BA per SKU (BA Code, SKU, Month, Brand, Target Kg).
 * Rows are grouped so each BA gets all their SKU targets for the month. The SKU must be one from the
 * SKU list (brand and grammage come from the list). Older templates (SKU Name, Sales, Grammage…) are
 * still read; sales are never taken from the file.
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
  // Target Kg is what Head Office fills (Units = Kg / Grammage). A file with only Units: kg = units x grammage.
  const unitsColumn = columns.has('target units') ? 'target units' : 'units'
  const byUnits = !columns.has('target kg') && columns.has(unitsColumn)
  if ((!byUnits && !columns.has('target kg')) || !columns.has('month') || !columns.has(skuColumn)) {
    return { rows: [], errors: ['The template needs BA Code, SKU, Month and Target Kg columns. Download a fresh template.'] }
  }

  const cell = (row: unknown[], header: string) => row[columns.get(header) ?? -1]
  const catalogue = await loadSkuCatalogue()
  if (catalogue.length === 0) {
    return { rows: [], errors: ['The SKU list could not be loaded from the server. Try again.'] }
  }
  const skuByName = new Map(catalogue.map((item) => [item.sku.replace(/\s+/g, ' ').trim().toLowerCase(), item]))
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
    const skuText = String(cell(row, skuColumn) ?? '').replace(/\s+/g, ' ').trim()
    const listed = skuByName.get(skuText.toLowerCase())
    const sku = listed?.sku ?? skuText
    const month = parseMonthCell(cell(row, 'month'), (value) => XLSX.SSF.parse_date_code(value))
    const units = byUnits ? parseKg(cell(row, unitsColumn)) : null
    const grammage = listed?.grammage || null
    const rawTarget = byUnits
      ? units === null
        ? null
        : units * (grammage ?? 0)
      : parseKg(cell(row, 'target kg'))
    if (rawTarget === null) return // nothing entered on this SKU: skipped
    const target = Math.round(rawTarget * 1000) / 1000

    const problems: string[] = []
    if (!code) problems.push('BA Code is required')
    if (!sku) problems.push('SKU is required')
    else if (!listed) problems.push(`SKU "${sku}" is not in the SKU list`)
    if (!month) problems.push('Month must be YYYY-MM, for example 2026-09')
    if (units !== null ? units < 0 : target < 0) problems.push(byUnits ? 'Units cannot be negative' : 'Target Kg cannot be negative')
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
    entry.lines!.push({
      sku,
      brand: listed?.range ?? '',
      kg: target,
      grammage: grammage ?? undefined,
      unit: units ?? (grammage ? Math.round(target / grammage) : null),
    })
    entry.targetKg = Math.round((entry.targetKg + target) * 1000) / 1000
    grouped.set(key, entry)
  })

  // The month total is whole kg (334.44 -> 334); each SKU keeps its exact kg.
  const rows = [...grouped.values()].map((row) => ({ ...row, targetKg: Math.round(row.targetKg) }))
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
        // Targets only: sales come from the BA's Daily Sales reports.
        // Target Kg per SKU; the server works out units = kg / grammage.
        lines: (row.lines ?? []).map(({ sku, brand, kg }) => ({ sku, brand, kg })),
      })),
    }),
  })
  const data = (await response.json().catch(() => ({}))) as {
    saved?: { baCode: string; month: string; updated?: boolean }[]
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
