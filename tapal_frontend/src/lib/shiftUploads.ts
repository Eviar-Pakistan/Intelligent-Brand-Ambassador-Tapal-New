import { currentMonthKey, parseMonthCell } from './baTargets'
import { djangoFetch, djangoToken } from './djangoApi'

/** One row = one monthly shift: a BA at a store at the same hours for the whole month. */
export type ShiftPlanRow = {
  row?: number
  baCode: string
  storeCode: string
  /** HH:MM, 24-hour, Karachi time. Shown and typed as 12-hour (10:00 AM). */
  startTime: string
  endTime: string
  /** YYYY-MM */
  month: string
}

export type ShiftSaveResult = {
  created: number
  skippedExisting: number
  conflicts: number
  rowsSaved: number
  errors: string[]
}

const SHIFT_SHEET = 'Shifts'
const SHIFT_COLUMNS = [
  { key: 'ba code', header: 'BA Code *', width: 16 },
  { key: 'store code', header: 'Store Code *', width: 16 },
  { key: 'start time', header: 'Start Time *', width: 14 },
  { key: 'end time', header: 'End Time *', width: 14 },
  { key: 'month', header: 'Month *', width: 12 },
] as const

const headerKey = (value: unknown) => String(value ?? '').replace(/\*/g, '').trim().toLowerCase()

const pad = (n: number) => String(n).padStart(2, '0')

/** Accepts 2:00 PM, 2 PM, 14:00, an Excel time fraction, or a Date. Returns 24-hour HH:MM or null. */
export function parseTimeCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60)
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
  }
  const match = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(String(value ?? '').trim())
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  const meridiem = match[3]?.toLowerCase()[0]
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0)
  } else if (match[2] === undefined) {
    return null
  }
  if (hour > 23 || minute > 59) return null
  return `${pad(hour)}:${pad(minute)}`
}

export async function downloadShiftTemplate(
  baCodes: { code: string; name: string }[],
  storeCodes: { code: string; name: string }[],
  month = currentMonthKey(),
) {
  const XLSX = await import('xlsx')
  const sampleBa = baCodes[0]?.code ?? 'BA-XXXXXX'
  const sampleStore = storeCodes[0]?.code ?? 'STORE-01'
  const sheet = XLSX.utils.aoa_to_sheet([
    SHIFT_COLUMNS.map((column) => column.header),
    [sampleBa, sampleStore, '10:00 AM', '6:00 PM', month],
  ])
  sheet['!cols'] = SHIFT_COLUMNS.map((column) => ({ wch: column.width }))
  for (const ref of ['C2', 'D2', 'E2']) {
    const cell = sheet[ref]
    if (cell) cell.z = '@'
  }

  const help = XLSX.utils.aoa_to_sheet([
    ['How to fill the shift template'],
    [],
    [`1. Use the "${SHIFT_SHEET}" sheet. Do not change the header row. Replace the sample row.`],
    ['2. One row is one monthly shift: the BA works at the store at these hours for that month.'],
    ['3. Start Time and End Time are 12-hour Karachi time with AM or PM, for example 10:00 AM and 6:30 PM. End must be after start.'],
    ['4. Month must be YYYY-MM, for example 2026-10.'],
    ['5. Uploading the same row again does not duplicate shifts.'],
    [],
    ['BA codes', '', 'Store codes'],
    ...Array.from({ length: Math.max(baCodes.length, storeCodes.length) }, (_, i) => [
      baCodes[i] ? `${baCodes[i].code} · ${baCodes[i].name}` : '',
      '',
      storeCodes[i] ? `${storeCodes[i].code} · ${storeCodes[i].name}` : '',
    ]),
  ])
  help['!cols'] = [{ wch: 36 }, { wch: 4 }, { wch: 40 }]

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, SHIFT_SHEET)
  XLSX.utils.book_append_sheet(book, help, 'Instructions')
  XLSX.writeFile(book, 'Tapal_BA_Shift_Template.xlsx')
}

export type ShiftParseResult = { rows: ShiftPlanRow[]; errors: string[] }

/** Checks format only. The server checks that BA and store codes exist. */
export function checkShiftRow(input: ShiftPlanRow): string[] {
  const problems: string[] = []
  if (!input.baCode) problems.push('BA code is required')
  if (!input.storeCode) problems.push('Store code is required')
  if (!input.startTime) problems.push('Start time must be like 10:00 AM')
  if (!input.endTime) problems.push('End time must be like 6:00 PM')
  // Overnight shifts allowed (e.g. 5:00 PM → 1:00 AM).
  if (!input.month) problems.push('Month must be YYYY-MM, for example 2026-10')
  return problems
}

export async function parseShiftFile(file: File): Promise<ShiftParseResult> {
  const XLSX = await import('xlsx')
  let table: unknown[][]
  try {
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
    const name = book.SheetNames.includes(SHIFT_SHEET) ? SHIFT_SHEET : book.SheetNames[0]
    table = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: true })
  } catch {
    return { rows: [], errors: ['This file could not be read. Please upload the downloaded .xlsx template.'] }
  }

  const headerAt = table.findIndex((row) => row.some((cell) => headerKey(cell) === 'ba code'))
  if (headerAt === -1) {
    return { rows: [], errors: ['This is not the shift template (no "BA Code" column). Download the template and fill that.'] }
  }
  const columns = new Map<string, number>()
  table[headerAt].forEach((header, index) => columns.set(headerKey(header), index))
  const missing = SHIFT_COLUMNS.filter((column) => !columns.has(column.key))
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [`The template is missing: ${missing.map((column) => column.header.replace(' *', '')).join(', ')}.`],
    }
  }

  const cell = (row: unknown[], key: string) => row[columns.get(key) ?? -1]
  const rows: ShiftPlanRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  table.slice(headerAt + 1).forEach((row, index) => {
    const rowNo = headerAt + index + 2
    if (row.every((value) => String(value ?? '').trim() === '')) return
    const input: ShiftPlanRow = {
      row: rowNo,
      baCode: String(cell(row, 'ba code') ?? '').trim().toUpperCase(),
      storeCode: String(cell(row, 'store code') ?? '').trim().toUpperCase(),
      startTime: parseTimeCell(cell(row, 'start time')) ?? '',
      endTime: parseTimeCell(cell(row, 'end time')) ?? '',
      month: parseMonthCell(cell(row, 'month'), (value) => XLSX.SSF.parse_date_code(value)) ?? '',
    }
    const problems = checkShiftRow(input)
    const key = `${input.baCode}|${input.storeCode}|${input.startTime}|${input.endTime}|${input.month}`
    if (problems.length === 0 && seen.has(key)) problems.push('Duplicate of an earlier row')
    seen.add(key)
    if (problems.length > 0) {
      errors.push(`Row ${rowNo}${input.baCode ? ` (${input.baCode})` : ''}: ${problems.join('; ')}.`)
      return
    }
    rows.push(input)
  })

  if (rows.length === 0 && errors.length === 0) errors.push('No shifts found. Fill at least one row.')
  return { rows, errors }
}

/** Saves shift plans to Django. Each row becomes one monthly shift. */
export async function saveShiftPlans(rows: ShiftPlanRow[]): Promise<ShiftSaveResult> {
  if (!djangoToken()) {
    return { created: 0, skippedExisting: 0, conflicts: 0, rowsSaved: 0, errors: ['Sign in to Head Office to save shifts.'] }
  }
  try {
    const response = await djangoFetch('/api/shifts/bulk/', {
      method: 'POST',
      body: JSON.stringify({
        rows: rows.map((r) => ({
          row: r.row,
          ba_code: r.baCode,
          store_code: r.storeCode,
          start_time: r.startTime,
          end_time: r.endTime,
          month: r.month,
        })),
      }),
    })
    const data = (await response.json().catch(() => ({}))) as {
      created?: number
      skipped_existing?: number
      conflicts?: number
      rows_saved?: number
      errors?: string[]
      detail?: string
    }
    return {
      created: data.created ?? 0,
      skippedExisting: data.skipped_existing ?? 0,
      conflicts: data.conflicts ?? 0,
      rowsSaved: data.rows_saved ?? 0,
      errors: data.errors?.length ? data.errors : data.detail ? [data.detail] : response.ok ? [] : ['Shifts could not be saved.'],
    }
  } catch {
    return { created: 0, skippedExisting: 0, conflicts: 0, rowsSaved: 0, errors: ['The server is not available. Start it, then try again.'] }
  }
}
