import { useSyncExternalStore } from 'react'

export type BaMonthTarget = {
  baId: string
  baName: string
  /** YYYY-MM */
  month: string
  targetKg: number
  salesKg: number
}

const STORAGE_KEY = 'ba-month-targets-v1'

const seed: BaMonthTarget[] = [
  { baId: 'ayesha', baName: 'Ayesha Khan', month: '2026-09', targetKg: 120, salesKg: 96 },
  { baId: 'sara', baName: 'Sara Ahmed', month: '2026-09', targetKg: 100, salesKg: 88 },
  { baId: 'fatima', baName: 'Fatima Noor', month: '2026-09', targetKg: 90, salesKg: 71 },
  { baId: 'hamza', baName: 'Hamza Ali', month: '2026-09', targetKg: 80, salesKg: 54 },
  { baId: 'ayesha', baName: 'Ayesha Khan', month: '2026-08', targetKg: 110, salesKg: 104 },
  { baId: 'sara', baName: 'Sara Ahmed', month: '2026-08', targetKg: 100, salesKg: 91 },
]

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
        typeof row.salesKg === 'number',
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
export function setBaMonthTargets(rows: BaMonthTarget[]) {
  if (rows.length === 0) return
  const keys = new Set(rows.map((row) => `${row.baId}:${row.month}`))
  const kept = targets.filter((row) => !keys.has(`${row.baId}:${row.month}`))
  commit([...rows.map((row) => ({ ...row, baName: row.baName.trim() })), ...kept])
}

export type TargetPerson = { id: string; name: string }

const TARGET_SHEET = 'Targets'
const TARGET_COLUMNS = [
  { key: 'name', header: 'Name *', width: 26 },
  { key: 'month', header: 'Month *', width: 14 },
  { key: 'target kg', header: 'Target Kg *', width: 14 },
  { key: 'sales kg', header: 'Sales Kg', width: 14 },
] as const

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

/** Downloads a template prefilled with every ambassador for the given month. */
export async function downloadTargetTemplate(people: TargetPerson[], month = currentMonthKey()) {
  const XLSX = await import('xlsx')
  const saved = targets.filter((row) => row.month === month)
  const body = [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => {
      const row = saved.find((item) => item.baId === person.id)
      return [person.name, month, row ? row.targetKg : '', row ? row.salesKg : '']
    })
  const sheet = XLSX.utils.aoa_to_sheet([TARGET_COLUMNS.map((column) => column.header), ...body])
  sheet['!cols'] = TARGET_COLUMNS.map((column) => ({ wch: column.width }))
  for (let index = 0; index < body.length; index += 1) {
    const cell = sheet[`B${index + 2}`]
    if (cell) cell.z = '@'
  }

  const help = XLSX.utils.aoa_to_sheet([
    ['How to fill the target template'],
    [],
    [`1. Use the "${TARGET_SHEET}" sheet. One row is one ambassador for one month. Do not change the header row.`],
    ['2. Month must be YYYY-MM, for example 2026-09. Copy a row to add another month.'],
    ['3. Target Kg is required on each row you want to save. A row with no Target Kg is left unchanged.'],
    ['4. Sales Kg can be left blank to keep the sales already saved (or 0 if none). The name must match an ambassador.'],
    ['5. Save the file, then upload it with Upload targets.'],
    [],
    TARGET_COLUMNS.map((column) => column.header),
    ['Ayesha Khan', '2026-09', 120, 96],
  ])
  help['!cols'] = [{ wch: 28 }, { wch: 88 }, { wch: 18 }, { wch: 16 }]

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, TARGET_SHEET)
  XLSX.utils.book_append_sheet(book, help, 'Instructions')
  XLSX.writeFile(book, 'Tapal_BA_Target_Template.xlsx')
}

export type TargetParseResult = { rows: BaMonthTarget[]; errors: string[] }

const targetHeaderKey = (value: unknown) => String(value ?? '').replace(/\*/g, '').trim().toLowerCase()

function parseMonthCell(value: unknown, parseDateCode: (value: number) => { y: number; m: number } | null) {
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

const normName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

/** Reads a filled target template. Valid rows are returned even when others have problems. */
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

  const headerAt = table.findIndex((row) => row.some((cell) => targetHeaderKey(cell) === 'name'))
  if (headerAt === -1) {
    return { rows: [], errors: ['This is not the target template (no "Name" column). Download the template and fill that.'] }
  }
  const columns = new Map<string, number>()
  table[headerAt].forEach((header, index) => columns.set(targetHeaderKey(header), index))
  if (!columns.has('target kg') || !columns.has('month')) {
    return { rows: [], errors: ['The template needs Name, Month, and Target Kg columns. Download a fresh template.'] }
  }

  const cell = (row: unknown[], header: string) => row[columns.get(header) ?? -1]
  const byName = new Map<string, TargetPerson[]>()
  for (const person of people) {
    const key = normName(person.name)
    byName.set(key, [...(byName.get(key) ?? []), person])
  }

  const rows: BaMonthTarget[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  table.slice(headerAt + 1).forEach((row, index) => {
    const rowNo = headerAt + index + 2
    if (row.every((value) => String(value ?? '').trim() === '')) return
    const name = String(cell(row, 'name') ?? '').trim()
    const month = parseMonthCell(cell(row, 'month'), (value) => XLSX.SSF.parse_date_code(value))
    const target = parseKg(cell(row, 'target kg'))
    const sales = parseKg(columns.has('sales kg') ? cell(row, 'sales kg') : '')
    if (target === null && sales === null) return

    const problems: string[] = []
    if (!name) problems.push('Name is required')
    if (!month) problems.push('Month must be YYYY-MM, for example 2026-09')
    if (target === null) problems.push('Target Kg is required')
    else if (target < 0) problems.push('Target Kg cannot be negative')
    if (sales !== null && sales < 0) problems.push('Sales Kg cannot be negative')

    const matches = name ? (byName.get(normName(name)) ?? []) : []
    if (name && matches.length === 0) problems.push(`No ambassador named "${name}"`)
    if (matches.length > 1) problems.push(`More than one ambassador is named "${name}"`)

    const person = matches.length === 1 ? matches[0] : null
    const key = person && month ? `${person.id}:${month}` : ''
    if (key && seen.has(key)) problems.push('Duplicate of an earlier row for this ambassador and month')
    if (key) seen.add(key)

    if (problems.length > 0) {
      errors.push(`Row ${rowNo}${name ? ` (${name})` : ''}: ${problems.join('; ')}.`)
      return
    }
    if (!person || !month || target === null) return
    const existing = targets.find((item) => item.baId === person.id && item.month === month)
    rows.push({
      baId: person.id,
      baName: person.name,
      month,
      targetKg: target,
      salesKg: sales === null ? (existing?.salesKg ?? 0) : sales,
    })
  })

  if (rows.length === 0 && errors.length === 0) {
    errors.push('No targets found. Enter Target Kg on each row you want to save.')
  }
  return { rows, errors }
}

export function targetForBa(baId: string, month: string, list: BaMonthTarget[]) {
  return list.find((row) => row.baId === baId && row.month === month) ?? null
}
