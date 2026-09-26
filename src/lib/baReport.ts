/**
 * BA daily report: field definitions shared by the manual forms, the Excel
 * template, and the dashboard inbox.
 */
import { useSyncExternalStore } from 'react'

export type FieldDef = { key: string; label: string }

export type ReportSection = { title: string; fields: FieldDef[] }

export type OtherBrandRow = { id: string; name: string; price: string }

export const interceptionFields: FieldDef[] = [
  { key: 'totalInterceptions', label: 'Total Interceptions' },
  { key: 'productiveCalls', label: 'Productive Calls' },
  { key: 'nonProductiveCalls', label: 'Non-Productive Calls' },
  { key: 'totalSalesKg', label: 'Total Sales (Kg)' },
]

export const competitiveFields: FieldDef[] = [
  { key: 'lipton', label: 'Lipton' },
  { key: 'vital', label: 'Vital' },
  { key: 'supreme', label: 'Supreme' },
  { key: 'others', label: 'Others' },
]

export const whyNotFields: FieldDef[] = [
  { key: 'taste', label: 'Taste' },
  { key: 'price', label: 'Price' },
  { key: 'packaging', label: 'Packaging' },
]

export const danedarSalesFields: FieldDef[] = [
  { key: 'danedar90', label: 'Danedar 90g' },
  { key: 'danedar190', label: 'Danedar 190g' },
  { key: 'danedar475', label: 'Danedar 475g' },
  { key: 'danedar900', label: 'Danedar 900g' },
  { key: 'familyPack900', label: 'Family Pack 900g' },
  { key: 'familyCarton5', label: 'Family Carton 5x475g' },
  { key: 'bulkTea25', label: 'Bulk Tea 2.5kg' },
  { key: 'salesDanedar', label: 'Sales-Danedar (Kg)' },
]

export const teaBagSalesFields: FieldDef[] = [
  { key: 'teaBags25', label: 'Tea Bags 25s' },
  { key: 'teaBags50', label: 'Tea Bags 50s' },
  { key: 'teaBags100', label: 'Tea Bags 100s' },
  { key: 'teaBags200', label: 'Tea Bags 200s' },
  { key: 'salesTeaBags', label: 'Sales-Tea Bags (packs)' },
]

export const specialtySalesFields: FieldDef[] = [
  { key: 'greenTea100', label: 'Green Tea 100g' },
  { key: 'greenTea200', label: 'Green Tea 200g' },
  { key: 'tezdum250', label: 'Tezdum 250g' },
  { key: 'flavored150', label: 'Flavored Tea 150g' },
  { key: 'salesSpecialty', label: 'Sales-Specialty (Kg)' },
]

export const stockDanedarFields: FieldDef[] = [
  { key: 'stockDanedar90', label: 'Danedar 90g' },
  { key: 'stockDanedar190', label: 'Danedar 190g' },
  { key: 'stockDanedar475', label: 'Danedar 475g' },
  { key: 'stockDanedar900', label: 'Danedar 900g' },
  { key: 'stockFamilyPack900', label: 'Family Pack 900g' },
  { key: 'stockFamilyCarton5', label: 'Family Carton 5x475g' },
  { key: 'stockBulkTea25', label: 'Bulk Tea 2.5kg' },
]

export const stockTeaBagFields: FieldDef[] = [
  { key: 'stockTeaBags25', label: 'Tea Bags 25s' },
  { key: 'stockTeaBags50', label: 'Tea Bags 50s' },
  { key: 'stockTeaBags100', label: 'Tea Bags 100s' },
  { key: 'stockTeaBags200', label: 'Tea Bags 200s' },
  { key: 'stockGreenTea100', label: 'Green Tea 100g' },
  { key: 'stockTezdum250', label: 'Tezdum 250g' },
]

export const STOCK_OPTIONS = ['In Stock', 'Out of Stock', 'Near Out of Stock'] as const

export const DEFAULT_OTHER_BRANDS: OtherBrandRow[] = [
  { id: '1', name: 'Lipton 190g', price: '' },
  { id: '2', name: 'Lipton 475g', price: '' },
  { id: '3', name: 'Vital 190g', price: '' },
  { id: '4', name: 'Vital 475g', price: '' },
  { id: '5', name: 'Supreme 190g', price: '' },
  { id: '6', name: 'Supreme Tea Bags 50s', price: '' },
]

/** Sections in the same order as the checkout flow: Stock → Daily Sales → Other Brands. */
const stockSections: ReportSection[] = [
  { title: 'Tapal Danedar', fields: stockDanedarFields },
  { title: 'Tea Bags & Specialty', fields: stockTeaBagFields },
]

const salesSections: ReportSection[] = [
  { title: 'Interceptions', fields: interceptionFields },
  { title: 'Competitive User', fields: competitiveFields },
  { title: 'Why Not Tapal', fields: whyNotFields },
  { title: 'Tapal Danedar', fields: danedarSalesFields },
  { title: 'Tea Bags', fields: teaBagSalesFields },
  { title: 'Specialty', fields: specialtySalesFields },
]

export const SESSION_KEYS = {
  stock: 'ba-stock-report',
  sales: 'ba-daily-sales',
  otherBrands: 'ba-other-brands',
  excelName: 'ba-reports-excel',
} as const

const TEMPLATE_SHEET = 'BA Report'
const HEADERS = ['Section', 'Item', 'Value', 'Notes', 'Key'] as const
const COL = { value: 2, key: 4 } as const

const NOTE_STOCK = `Type one of: ${STOCK_OPTIONS.join(' / ')}`
const NOTE_NUMBER = 'Number (0 or more) — leave blank if none'
const NOTE_PRICE = 'Selling price in Rs.'

const brandKey = (row: OtherBrandRow) => `brand-${row.id}`

/** Builds and downloads the .xlsx template with every field of the checkout forms. */
export async function downloadBaReportTemplate() {
  const XLSX = await import('xlsx')

  const rows: (string | number)[][] = [[...HEADERS]]
  for (const s of stockSections) {
    for (const f of s.fields) rows.push([`Stock Report – ${s.title}`, f.label, '', NOTE_STOCK, f.key])
  }
  for (const s of salesSections) {
    for (const f of s.fields) rows.push([`Daily Sales – ${s.title}`, f.label, '', NOTE_NUMBER, f.key])
  }
  for (const b of DEFAULT_OTHER_BRANDS) {
    rows.push(['Other Brands', b.name, '', `${NOTE_PRICE} — optional`, brandKey(b)])
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 34 }, { wch: 26 }, { wch: 20 }, { wch: 52 }, { wch: 22 }]

  const instructions = XLSX.utils.aoa_to_sheet([
    ['Tapal BA Daily Report — how to fill'],
    [],
    [`1. Fill only the "Value" column (column C) on the "${TEMPLATE_SHEET}" sheet.`],
    [`2. Stock Report: every item is required. Type: ${STOCK_OPTIONS.join(' / ')}.`],
    ['3. Daily Sales: numbers only (0 or more). Leave an item blank if it does not apply.'],
    ['4. Other Brands: optional. Enter a selling price in Rs. only for packs you checked.'],
    ['5. Do not rename, move or delete rows, and do not edit the "Key" column.'],
    ['6. Save the file, then upload it from the BA app home screen after check-in.'],
  ])
  instructions['!cols'] = [{ wch: 96 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, TEMPLATE_SHEET)
  XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `Tapal_BA_Daily_Report_Template_${date}.xlsx`)
}

export type ParsedBaReport = {
  stock: Record<string, string>
  sales: Record<string, string>
  otherBrands: OtherBrandRow[]
}

export type ParseResult = { ok: true; data: ParsedBaReport } | { ok: false; errors: string[] }

/** "in stock", "Out-of-Stock", "NEAR OUT OF STOCK" → canonical option. */
function normalizeStock(raw: string) {
  const squashed = raw.toLowerCase().replace(/[^a-z]/g, '')
  return STOCK_OPTIONS.find((o) => o.toLowerCase().replace(/[^a-z]/g, '') === squashed) ?? null
}

/** Reads a filled template. Returns every problem found so the BA can fix them in one go. */
export async function parseBaReportFile(file: File): Promise<ParseResult> {
  const XLSX = await import('xlsx')

  let table: unknown[][]
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const name = wb.SheetNames.includes(TEMPLATE_SHEET) ? TEMPLATE_SHEET : wb.SheetNames[0]
    table = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true })
  } catch {
    return { ok: false, errors: ['This file could not be read. Please upload the downloaded .xlsx template.'] }
  }

  const headerAt = table.findIndex((r) => String(r[COL.key] ?? '').trim().toLowerCase() === 'key')
  if (headerAt === -1) {
    return {
      ok: false,
      errors: ['This is not the BA report template (Key column not found). Download the template and fill that.'],
    }
  }

  const cells = new Map<string, { value: string; row: number; item: string }>()
  table.slice(headerAt + 1).forEach((r, i) => {
    const key = String(r[COL.key] ?? '').trim()
    if (!key) return
    const raw = r[COL.value]
    cells.set(key, {
      value: typeof raw === 'number' ? String(raw) : String(raw ?? '').trim(),
      row: headerAt + i + 2,
      item: String(r[1] ?? key),
    })
  })

  const errors: string[] = []
  const at = (key: string, label: string) => {
    const c = cells.get(key)
    if (!c) errors.push(`Row for "${label}" is missing — do not delete rows from the template.`)
    return c
  }

  const stock: Record<string, string> = {}
  for (const s of stockSections) {
    for (const f of s.fields) {
      const c = at(f.key, `Stock – ${f.label}`)
      if (!c) continue
      const status = c.value ? normalizeStock(c.value) : null
      if (!status) {
        errors.push(
          `Row ${c.row} (Stock – ${s.title} – ${f.label}): choose ${STOCK_OPTIONS.join(', ')}${c.value ? ` (found "${c.value}")` : ''}.`,
        )
      } else {
        stock[f.key] = status
      }
    }
  }

  const parseNumber = (c: { value: string; row: number }, where: string) => {
    if (!c.value) return ''
    const n = Number(c.value.replace(/,/g, ''))
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`Row ${c.row} (${where}): enter a number 0 or more (found "${c.value}").`)
      return ''
    }
    return String(n)
  }

  const sales: Record<string, string> = {}
  for (const s of salesSections) {
    for (const f of s.fields) {
      const c = at(f.key, `Daily Sales – ${f.label}`)
      if (c) sales[f.key] = parseNumber(c, `Daily Sales – ${s.title} – ${f.label}`)
    }
  }

  const otherBrands = DEFAULT_OTHER_BRANDS.map((b) => {
    const c = at(brandKey(b), `Other Brands – ${b.name}`)
    return { ...b, price: c ? parseNumber(c, `Other Brands – ${b.name}`) : '' }
  })
  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: { stock, sales, otherBrands } }
}

/** Saves a parsed report where the manual checkout flow keeps it. */
export function saveBaReport(data: ParsedBaReport, fileName: string) {
  sessionStorage.setItem(SESSION_KEYS.stock, JSON.stringify(data.stock))
  sessionStorage.setItem(SESSION_KEYS.sales, JSON.stringify(data.sales))
  sessionStorage.setItem(SESSION_KEYS.otherBrands, JSON.stringify(data.otherBrands))
  sessionStorage.setItem(SESSION_KEYS.excelName, fileName)
}

export type ReportSource = 'checkout' | 'anytime' | 'excel'

export type StoredDailyReport = {
  id: string
  baId: string
  baName: string
  city: string
  submittedAt: string
  source: ReportSource
  stock: Record<string, string>
  sales: Record<string, string>
  otherBrands: OtherBrandRow[]
}

const REPORTS_KEY = 'ba-daily-reports-v1'

function loadReports(): StoredDailyReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let reports = loadReports()
const reportListeners = new Set<() => void>()

function subscribeReports(listener: () => void) {
  reportListeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== REPORTS_KEY) return
    reports = loadReports()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    reportListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Sends a completed daily report to the head-office dashboard inbox. */
export function recordDailyReport(
  data: ParsedBaReport,
  meta: { baId: string; baName: string; city: string; source: ReportSource },
) {
  const entry: StoredDailyReport = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    baId: meta.baId,
    baName: meta.baName,
    city: meta.city,
    submittedAt: new Date().toISOString(),
    source: meta.source,
    stock: data.stock,
    sales: data.sales,
    otherBrands: data.otherBrands,
  }
  reports = [entry, ...reports].slice(0, 200)
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports))
  } catch {
    // keep the in-memory list
  }
  reportListeners.forEach((listener) => listener())
  return entry
}

export function useDailyReports() {
  return useSyncExternalStore(subscribeReports, () => reports, () => [])
}

function isSameLocalDay(iso: string, now: Date) {
  const d = new Date(iso)
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/** True when this BA already sent today's stock report through the anytime form. */
export function hasAnytimeStockSubmitted(baId: string, list: StoredDailyReport[], now = new Date()) {
  return list.some(
    (report) =>
      report.baId === baId &&
      report.source === 'anytime' &&
      isSameLocalDay(report.submittedAt, now) &&
      Object.values(report.stock).some((value) => value.trim() !== ''),
  )
}

const salesLabel = new Map(
  [
    ...interceptionFields,
    ...competitiveFields,
    ...whyNotFields,
    ...danedarSalesFields,
    ...teaBagSalesFields,
    ...specialtySalesFields,
  ].map((field) => [field.key, field.label]),
)

export type ExtractKind = 'stock' | 'sales' | 'competitors'

function linesFor(kind: ExtractKind, report: StoredDailyReport) {
  if (kind === 'stock') {
    return [...stockDanedarFields, ...stockTeaBagFields].map((field) => ({
      section: stockDanedarFields.some((item) => item.key === field.key)
        ? 'Tapal Danedar'
        : 'Tea Bags & Specialty',
      item: field.label,
      value: report.stock[field.key] ?? '',
    }))
  }
  if (kind === 'sales') {
    return [...salesSections].flatMap((section) =>
      section.fields.map((field) => ({
        section: section.title,
        item: salesLabel.get(field.key) ?? field.label,
        value: report.sales[field.key] ?? '',
      })),
    )
  }
  return report.otherBrands.map((brand) => ({
    section: 'Other Brands',
    item: brand.name,
    value: brand.price,
  }))
}

const EXTRACT_FILE: Record<ExtractKind, string> = {
  stock: 'Stock_Report',
  sales: 'Daily_Sales',
  competitors: 'Competitor_Data',
}

/** Downloads one slice of every received BA daily report. */
export async function downloadReportExtract(kind: ExtractKind, list: StoredDailyReport[]) {
  const XLSX = await import('xlsx')
  const rows: (string | number)[][] = [['Submitted', 'BA', 'City', 'Source', 'Section', 'Item', 'Value']]
  for (const report of list) {
    const when = new Date(report.submittedAt).toLocaleString('en-PK')
    for (const line of linesFor(kind, report)) {
      rows.push([when, report.baName, report.city, report.source, line.section, line.item, line.value])
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 26 }, { wch: 18 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, EXTRACT_FILE[kind].replaceAll('_', ' '))
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(book, `Tapal_BA_${EXTRACT_FILE[kind]}_${date}.xlsx`)
}

export function labeledStock(stock: Record<string, string>) {
  return linesFor('stock', {
    id: '',
    baId: '',
    baName: '',
    city: '',
    submittedAt: '',
    source: 'anytime',
    stock,
    sales: {},
    otherBrands: [],
  })
}

export function labeledSales(sales: Record<string, string>) {
  return linesFor('sales', {
    id: '',
    baId: '',
    baName: '',
    city: '',
    submittedAt: '',
    source: 'anytime',
    stock: {},
    sales,
    otherBrands: [],
  })
}
