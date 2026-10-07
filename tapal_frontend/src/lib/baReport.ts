/**
 * BA daily report: field definitions shared by the manual forms, the Excel
 * template, and the dashboard inbox.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { currentBaAccountId, isDemoBa } from './baAccounts'
import type { BaMonthTarget } from './baTargets'
import { canonicalSkuName } from './skuNames'
import { djangoToken } from './djangoApi'
import { currentPortal, portalGet, portalSend, resultsOf } from './serverApi'

export type FieldDef = { key: string; label: string }

export type ReportSection = { title: string; fields: FieldDef[] }

export type OtherBrandRow = { id: string; name: string; price: string; fieldType?: 'text' | 'number' }

export const interceptionFields: FieldDef[] = [
  { key: 'totalInterceptions', label: 'Total Interceptions' },
  { key: 'productiveCalls', label: 'Productive Calls' },
  { key: 'nonProductiveCalls', label: 'Non-Productive Calls' },
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

/** Interceptions, Competitive User and Why Not Tapal: the same for every BA. */
export const fixedSalesSections: ReportSection[] = [
  { title: 'Interceptions', fields: interceptionFields },
  { title: 'Competitive User', fields: competitiveFields },
  { title: 'Why Not Tapal', fields: whyNotFields },
]

/** The SKU lists used when a BA has no SKU target this month. */
const defaultStockSections: ReportSection[] = [
  { title: 'Tapal Danedar', fields: stockDanedarFields },
  { title: 'Tea Bags & Specialty', fields: stockTeaBagFields },
]

const defaultSkuSalesSections: ReportSection[] = [
  { title: 'Tapal Danedar', fields: danedarSalesFields },
  { title: 'Tea Bags', fields: teaBagSalesFields },
  { title: 'Specialty', fields: specialtySalesFields },
]

/** The SKUs one BA reports on: stock status per SKU, and sales per SKU (after the fixed sections). */
export type ReportSections = {
  stock: ReportSection[]
  skuSales: ReportSection[]
  /** True when the SKUs come from the BA's target for the month. */
  fromTarget: boolean
}

const STOCK_SKU_PREFIX = 'stock:'
/** Older reports: SKU sales in kg. */
const SALES_SKU_PREFIX = 'sku:'
/** SKU sales in units (whole packs). */
const SALES_UNIT_PREFIX = 'unit:'

/** True for a Daily Sales SKU field: units must be whole numbers. */
export function isUnitSalesKey(key: string) {
  return key.startsWith(SALES_UNIT_PREFIX)
}

/** A whole number of units: digits only, no decimals, no sign. */
export function isWholeUnits(value: string) {
  return /^\d+$/.test(value.trim())
}

const DEFAULT_SECTIONS: ReportSections = {
  stock: defaultStockSections,
  skuSales: defaultSkuSalesSections,
  fromTarget: false,
}

/** Build the SKU sections from the BA's month target, grouped by brand (target order kept). */
export function sectionsFromTarget(target: BaMonthTarget | null | undefined): ReportSections {
  const byBrand = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const line of target?.lines ?? []) {
    const sku = String(line.sku ?? '').trim()
    if (!sku || seen.has(sku.toLowerCase())) continue
    seen.add(sku.toLowerCase())
    const brand = String(line.brand ?? '').trim() || 'Target SKUs'
    byBrand.set(brand, [...(byBrand.get(brand) ?? []), sku])
  }
  if (byBrand.size === 0) return DEFAULT_SECTIONS
  const groups = [...byBrand.entries()]
  return {
    stock: groups.map(([title, skus]) => ({
      title,
      fields: skus.map((sku) => ({ key: `${STOCK_SKU_PREFIX}${sku}`, label: sku })),
    })),
    skuSales: groups.map(([title, skus]) => ({
      title: `${title} · sales (units)`,
      fields: skus.map((sku) => ({ key: `${SALES_UNIT_PREFIX}${sku}`, label: sku })),
    })),
    fromTarget: true,
  }
}

/** A SKU on a city's list: the name the BA sees, and the SKU its stock and sales are saved under. */
export type CityReportSku = { brand: string; label: string; sku: string }

/** The SKU sections for a city's own list (Lahore, Multan), grouped by brand in the list's order. */
export function sectionsFromCityList(list: CityReportSku[]): ReportSections {
  const byBrand = new Map<string, CityReportSku[]>()
  const seen = new Set<string>()
  for (const item of list) {
    if (seen.has(item.sku)) continue
    seen.add(item.sku)
    byBrand.set(item.brand, [...(byBrand.get(item.brand) ?? []), item])
  }
  const groups = [...byBrand.entries()]
  return {
    stock: groups.map(([title, items]) => ({
      title,
      fields: items.map((item) => ({ key: `${STOCK_SKU_PREFIX}${item.sku}`, label: item.label })),
    })),
    skuSales: groups.map(([title, items]) => ({
      title: `${title} · sales (units)`,
      fields: items.map((item) => ({ key: `${SALES_UNIT_PREFIX}${item.sku}`, label: item.label })),
    })),
    fromTarget: false,
  }
}

let cachedSections: ReportSections | null = null

/**
 * The signed-in BA's report SKUs from /api/ba/me/: this month's target SKUs when present,
 * else their city's SKU list, else the default list.
 */
export async function loadReportSections(): Promise<ReportSections> {
  const me = await portalGet<{ monthTarget: BaMonthTarget | null; reportSkus?: CityReportSku[] | null }>(
    '/api/ba/me/',
    'ba',
  )
  if (me) {
    const targetSections = sectionsFromTarget(me.monthTarget)
    cachedSections = targetSections.fromTarget
      ? targetSections
      : me.reportSkus?.length
        ? sectionsFromCityList(me.reportSkus)
        : DEFAULT_SECTIONS
  }
  return cachedSections ?? DEFAULT_SECTIONS
}

/** Null while the BA's SKUs load. */
export function useReportSections() {
  const [sections, setSections] = useState<ReportSections | null>(cachedSections)
  useEffect(() => {
    let cancelled = false
    void loadReportSections().then((next) => {
      if (!cancelled) setSections(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return sections
}

export const SESSION_KEYS = {
  stock: 'ba-stock-report',
  sales: 'ba-daily-sales',
  otherBrands: 'ba-other-brands',
  /** Set when the BA chose to continue from Daily Sales with every field empty or 0. */
  salesSkipped: 'ba-sales-skipped',
  excelName: 'ba-reports-excel',
} as const

const TEMPLATE_SHEET = 'BA Report'
const HEADERS = ['Section', 'Item', 'Value', 'Notes', 'Key'] as const
const COL = { value: 2, key: 4 } as const

const NOTE_STOCK = `Type one of: ${STOCK_OPTIONS.join(' / ')}`
const NOTE_NUMBER = 'Number (0 or more) — leave blank if none'
const NOTE_UNITS = 'Whole number of units (0 or more), no decimals — leave blank if none'
const NOTE_PRICE = 'Selling price in Rs.'

const brandKey = (row: OtherBrandRow) => `brand-${row.id}`

/** Builds and downloads the .xlsx template with every field of the checkout forms (this BA's SKUs). */
export async function downloadBaReportTemplate() {
  const XLSX = await import('xlsx')
  const sections = await loadReportSections()

  const rows: (string | number)[][] = [[...HEADERS]]
  for (const s of sections.stock) {
    for (const f of s.fields) rows.push([`Stock Report – ${s.title}`, f.label, '', NOTE_STOCK, f.key])
  }
  for (const s of [...fixedSalesSections, ...sections.skuSales]) {
    for (const f of s.fields) {
      rows.push([`Daily Sales – ${s.title}`, f.label, '', isUnitSalesKey(f.key) ? NOTE_UNITS : NOTE_NUMBER, f.key])
    }
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
    ['3. Daily Sales: numbers only (0 or more). SKU sales are whole units — no decimals. Leave an item blank if it does not apply.'],
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
  const sections = await loadReportSections()

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
  for (const s of sections.stock) {
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
  for (const s of [...fixedSalesSections, ...sections.skuSales]) {
    for (const f of s.fields) {
      const c = at(f.key, `Daily Sales – ${f.label}`)
      if (!c) continue
      if (isUnitSalesKey(f.key) && c.value && !isWholeUnits(c.value.replace(/,/g, ''))) {
        errors.push(`Row ${c.row} (Daily Sales – ${s.title} – ${f.label}): units must be a whole number, no decimals (found "${c.value}").`)
        sales[f.key] = ''
        continue
      }
      sales[f.key] = parseNumber(c, `Daily Sales – ${s.title} – ${f.label}`)
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
  /** Filled by the server */
  baCode?: string
  submittedById?: string
  submittedByName?: string
  storeId?: number | null
  storeName?: string
  city: string
  submittedAt: string
  source: ReportSource
  stock: Record<string, string>
  sales: Record<string, string>
  otherBrands: OtherBrandRow[]
  /** Sent to the server for checking only. Never shown in the app. */
  noSalesConfirmed?: boolean
  /** Submitted on this device but not accepted by the server yet; sent again on the next sync. */
  unsent?: boolean
}

const REPORTS_KEY = 'ba-daily-reports-v1'

function loadReports(): StoredDailyReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    // Demo activity is session-only — never restore it from the browser.
    const cleaned = parsed.filter((row) => row && typeof row === 'object' && !isDemoBa(String(row.baId ?? '')))
    if (cleaned.length !== parsed.length) {
      try {
        localStorage.setItem(REPORTS_KEY, JSON.stringify(cleaned))
      } catch {
        // ignore
      }
    }
    return cleaned
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
    // Keep this tab's in-memory demo reports; refresh only non-demo rows from storage.
    const demoKeep = reports.filter((r) => isDemoBa(r.baId))
    reports = [...demoKeep, ...loadReports()]
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    reportListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function commitReports(next: StoredDailyReport[]) {
  reports = next.slice(0, 500)
  try {
    // Persist real BA reports only. Demo sales stay in memory for Rewards this session.
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports.filter((r) => !isDemoBa(r.baId))))
  } catch {
    // keep the in-memory list
  }
  reportListeners.forEach((listener) => listener())
}

async function sendReport(entry: StoredDailyReport) {
  if (currentPortal() !== 'ba' || isDemoBa(entry.baId)) return
  try {
    const { unsent: _unsent, ...body } = entry
    void _unsent
    const saved = await portalSend<StoredDailyReport>('/api/daily-reports/', 'POST', body, 'ba')
    if (saved) commitReports(reports.map((item) => (item.id === entry.id ? saved : item)))
  } catch (error) {
    console.warn('[reports] not sent yet:', error instanceof Error ? error.message : error)
  }
}

/**
 * Loads reports from the server (/api/daily-reports/): Head Office sees all, a supervisor their
 * stores, a BA their own. Reports this device could not send yet are sent first.
 */
export async function syncDailyReports() {
  const portal = currentPortal()
  if (portal === 'shopper' || (portal === 'office' && !djangoToken())) return
  let rows = resultsOf(await portalGet<{ results: StoredDailyReport[] }>('/api/daily-reports/', portal))
  if (!rows) return
  if (portal === 'ba') {
    // Send every report this BA made on this phone that the server does not have yet.
    const me = currentBaAccountId()
    const onServer = new Set(rows.map((row) => row.id))
    const missing = reports.filter((r) => r.baId === me && !onServer.has(r.id))
    for (const entry of missing) await sendReport(entry)
    if (missing.length) rows = resultsOf(await portalGet<{ results: StoredDailyReport[] }>('/api/daily-reports/', portal)) ?? rows
  }
  const onServer = new Set(rows.map((row) => row.id))
  commitReports([
    ...reports.filter((r) => !onServer.has(r.id) && (portal === 'ba' || r.unsent || isDemoBa(r.baId))),
    ...rows,
  ])
}

/** Sends a completed daily report to the head-office dashboard inbox. */
export function recordDailyReport(
  data: ParsedBaReport,
  meta: { baId: string; baName: string; city: string; source: ReportSource; noSalesConfirmed?: boolean },
) {
  const entry: StoredDailyReport = {
    id: `rep-${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`,
    baId: meta.baId,
    baName: meta.baName,
    city: meta.city,
    submittedAt: new Date().toISOString(),
    source: meta.source,
    stock: data.stock,
    sales: data.sales,
    otherBrands: data.otherBrands,
    ...(meta.noSalesConfirmed ? { noSalesConfirmed: true } : {}),
  }
  const localOnly = isDemoBa(meta.baId)
  commitReports([{ ...entry, ...(localOnly ? {} : { unsent: true }) }, ...reports])
  if (!localOnly) void sendReport(entry)
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

const legacyStockKeys = new Set(defaultStockSections.flatMap((section) => section.fields.map((field) => field.key)))
const legacySales = new Map(
  defaultSkuSalesSections.flatMap((section) =>
    section.fields.map((field) => [field.key, { section: section.title, label: field.label }] as const),
  ),
)
const fixedSalesKeys = new Set(fixedSalesSections.flatMap((section) => section.fields.map((field) => field.key)))
// Backend-derived total; retain it in report exports without showing it in the BA form.
const derivedSalesKeys = new Set(['totalSalesKg'])

export type ExtractKind = 'stock' | 'sales' | 'competitors'

function linesFor(kind: ExtractKind, report: StoredDailyReport) {
  if (kind === 'stock') {
    const hasTargetSkus = Object.keys(report.stock).some((key) => !legacyStockKeys.has(key))
    // Reports on the default list show every default SKU; target-SKU reports show what was sent.
    const legacy = defaultStockSections.flatMap((section) =>
      section.fields
        .filter((field) => !hasTargetSkus || field.key in report.stock)
        .map((field) => ({ section: section.title, item: field.label, value: report.stock[field.key] ?? '' })),
    )
    const skus = Object.entries(report.stock)
      .filter(([key]) => !legacyStockKeys.has(key))
      .map(([key, value]) => ({ section: 'Target SKUs', item: key.replace(STOCK_SKU_PREFIX, ''), value }))
    return [...legacy, ...skus]
  }
  if (kind === 'sales') {
    const fixed = fixedSalesSections.flatMap((section) =>
      section.fields.map((field) => ({ section: section.title, item: field.label, value: report.sales[field.key] ?? '' })),
    )
    if (report.sales.totalSalesKg !== undefined) {
      fixed.push({ section: 'Interceptions', item: 'Total Sales (Kg)', value: report.sales.totalSalesKg })
    }
    const skus = Object.entries(report.sales)
      .filter(([key]) => !fixedSalesKeys.has(key) && !derivedSalesKeys.has(key))
      .map(([key, value]) => {
        const legacy = legacySales.get(key)
        const rawSkuName = key.startsWith(SALES_UNIT_PREFIX)
          ? key.replace(SALES_UNIT_PREFIX, '')
          : key.startsWith(SALES_SKU_PREFIX)
            ? key.replace(SALES_SKU_PREFIX, '')
            : legacy?.label ?? key
        const item = canonicalSkuName(rawSkuName)
        return legacy
          ? { section: legacy.section, item, value }
          : isUnitSalesKey(key)
            ? { section: 'SKU sales (units)', item, value }
            : { section: 'SKU sales (kg)', item, value }
      })
    return [...fixed, ...skus]
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

export type ReportFieldEntry = { key: string; label: string; value: string }

/** Stock rows with storage keys (for MIS editing). */
export function stockFieldEntries(stock: Record<string, string>): ReportFieldEntry[] {
  const hasTargetSkus = Object.keys(stock).some((key) => !legacyStockKeys.has(key))
  const legacy = defaultStockSections.flatMap((section) =>
    section.fields
      .filter((field) => !hasTargetSkus || field.key in stock)
      .map((field) => ({ key: field.key, label: field.label, value: stock[field.key] ?? '' })),
  )
  const skus = Object.entries(stock)
    .filter(([key]) => !legacyStockKeys.has(key))
    .map(([key, value]) => ({ key, label: key.replace(STOCK_SKU_PREFIX, ''), value }))
  return [...legacy, ...skus]
}

/** Sales rows with storage keys (for MIS editing). totalSalesKg is omitted — server recalculates it. */
export function salesFieldEntries(sales: Record<string, string>): ReportFieldEntry[] {
  const fixed = fixedSalesSections.flatMap((section) =>
    section.fields.map((field) => ({ key: field.key, label: field.label, value: sales[field.key] ?? '' })),
  )
  const skus = Object.entries(sales)
    .filter(([key]) => !fixedSalesKeys.has(key) && !derivedSalesKeys.has(key))
    .map(([key, value]) => {
      const legacy = legacySales.get(key)
      const rawSkuName = key.startsWith(SALES_UNIT_PREFIX)
        ? key.replace(SALES_UNIT_PREFIX, '')
        : key.startsWith(SALES_SKU_PREFIX)
          ? key.replace(SALES_SKU_PREFIX, '')
          : legacy?.label ?? key
      const label = canonicalSkuName(rawSkuName)
      return { key, label, value }
    })
  return [...fixed, ...skus]
}

/** MIS Head Office: save corrections to an existing daily report. */
export async function updateDailyReportAsMis(
  id: string,
  patch: { stock: Record<string, string>; sales: Record<string, string>; otherBrands: OtherBrandRow[] },
): Promise<StoredDailyReport> {
  const saved = await portalSend<StoredDailyReport>(
    '/api/daily-reports/',
    'PATCH',
    { id, stock: patch.stock, sales: patch.sales, otherBrands: patch.otherBrands },
    'office',
  )
  if (!saved) throw new Error('Could not save the report.')
  commitReports(reports.map((item) => (item.id === id ? { ...item, ...saved } : item)))
  return saved
}
