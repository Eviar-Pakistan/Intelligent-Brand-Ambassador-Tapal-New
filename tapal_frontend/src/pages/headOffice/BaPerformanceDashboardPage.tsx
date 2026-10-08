import { useUserInterceptions } from '../../lib/userInterceptions'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { Download, RotateCcw, Search } from 'lucide-react'
import { Button, Card, CardHeader, cn, KpiCard, TableScroll } from '../../components/ui'
import {
  aggregateBaPerformance,
  MONTH_ORDER,
  periodsForCalendarRange,
  recordsFromTargets,
  type BaPerformanceRecord,
} from '../../data/baPerformance'
import {
  categoryColors,
  chartGold,
  chartGreen,
  chartGreenLight,
  chartGrid,
  chartTick,
  defaultChartOptions,
} from '../../lib/chartjs'
import type { ChartData, ChartOptions } from 'chart.js'
import { achievementPct, useBaTargets } from '../../lib/baTargets'
import { isDemoBa, useBaAccounts } from '../../lib/baAccounts'
import { reportSalesInRange, syncDailyReports, useDailyReports } from '../../lib/baReport'
import { syncBaTargets } from '../../lib/djangoSync'
import { useDjangoUser } from '../../lib/djangoApi'
import { loadSkuCatalogue, type SkuRow } from '../../lib/skuCatalogue'
import { useCreatedStores } from '../../lib/storeRegistry'
import { stores as allStores } from '../../data/mock'

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr className="border-t border-slate-100">
      <td colSpan={cols} className="px-4 py-6 text-center text-sm text-slate-400">
        No data for this selection
      </td>
    </tr>
  )
}

type FilterPanelProps = {
  title: string
  options: string[]
  value: string[]
  onChange: (value: string[]) => void
  fill?: boolean
  className?: string
}

function FilterPanel({ title, options, value, onChange, fill, className }: FilterPanelProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, query])

  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-slate-100 bg-white',
        fill && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2">
        <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{title}</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-slate-400">
            {value.length === 0 ? 'All' : `${value.length} selected`}
          </span>
        <button
          type="button"
          title="Clear filter"
          onClick={() => {
            onChange([])
            setQuery('')
          }}
          className="rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-slate-600"
        >
          <RotateCcw size={12} />
        </button>
        </div>
      </div>
      <div className="border-b border-slate-50 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
          <Search size={12} className="shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>
      <div
        className={cn(
          'overflow-y-auto overscroll-contain',
          fill ? 'max-h-52 sm:max-h-60 lg:max-h-72' : 'max-h-36',
        )}
      >
        {filtered.map((option) => {
          const selected = value.includes(option)
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(option)}
              className={`block w-full px-3 py-2 text-left text-xs transition ${
                selected ? 'bg-brand-50/80 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {option}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-slate-400">No matches</p>
        )}
      </div>
    </div>
  )
}

const CHART_HEIGHT = 'h-[220px]'

function ChartCard({
  title,
  action,
  children,
  className,
  plotClassName = CHART_HEIGHT,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
  plotClassName?: string
}) {
  return (
    <Card padding={false} className={cn('h-full', className)}>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-50 px-4 py-2">
        <h3 className="truncate text-sm font-medium text-slate-700">{title}</h3>
        {action}
      </div>
      <div className="p-3 sm:p-4">
        <div className={cn('relative w-full', plotClassName)}>{children}</div>
      </div>
    </Card>
  )
}

const scaleDefaults = {
  grid: { color: chartGrid },
  ticks: { color: chartTick, font: { size: 11 } },
  border: { display: false },
}

type DatePreset = 'today' | 'yesterday' | 'mtd' | 'ytd' | 'custom'

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'mtd', label: 'Month to date' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'custom', label: 'Custom date' },
]

function monthNameFromDate(d: Date) {
  return MONTH_ORDER[d.getMonth()]
}

function monthsTouched(start: Date, end: Date) {
  const names: string[] = []
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const name = MONTH_ORDER[d.getMonth()]
    if (!names.includes(name)) names.push(name)
  }
  return names
}

function filterLiveRecords(
  records: BaPerformanceRecord[],
  filters: { towns: string[]; stores: string[]; months: string[] },
) {
  return records.filter(
    (record) =>
      (filters.towns.length === 0 || filters.towns.includes(record.town)) &&
      (filters.stores.length === 0 || filters.stores.includes(record.store)) &&
      (filters.months.length === 0 || filters.months.includes(record.month)),
  )
}

function monthForPreset(preset: DatePreset, customFrom?: string, customTo?: string): string | null {
  const today = new Date()
  if (preset === 'ytd') return null
  if (preset === 'custom') {
    if (!customFrom || !customTo) return null
    const from = parseDateInput(customFrom)
    const to = parseDateInput(customTo)
    if (!from || !to) return null
    const fromMonth = monthNameFromDate(from)
    const toMonth = monthNameFromDate(to)
    if (fromMonth === toMonth) return fromMonth
    return null
  }
  const d =
    preset === 'yesterday' ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1) : today
  return monthNameFromDate(d)
}

function dateInputValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayInputValue() {
  return dateInputValue(new Date())
}

/** The calendar span of a data month (this year), clamped by dateRangeForPreset to today. */
function dateRangeForMonth(monthName: string) {
  const monthIdx = MONTH_ORDER.indexOf(monthName)
  const now = new Date()
  const from = new Date(now.getFullYear(), monthIdx, 1)
  const to = new Date(now.getFullYear(), monthIdx + 1, 0)
  return { from: dateInputValue(from), to: dateInputValue(to) }
}

function dateRangeForMonths(months: string[]) {
  const indexes = months
    .map((month) => MONTH_ORDER.indexOf(month))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
  const first = dateRangeForMonth(MONTH_ORDER[indexes[0]])
  const last = dateRangeForMonth(MONTH_ORDER[indexes[indexes.length - 1]])
  return { from: first.from, to: last.to }
}

function parseDateInput(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** Inclusive start/end dates for a preset; null while a custom range is incomplete or invalid. */
function dateRangeForPreset(preset: DatePreset, customFrom: string, customTo: string) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (preset) {
    case 'today':
      return { start: today, end: today }
    case 'yesterday': {
      const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
      return { start: y, end: y }
    }
    case 'mtd':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today }
    case 'ytd':
      return { start: new Date(today.getFullYear(), 0, 1), end: today }
    case 'custom': {
      const start = parseDateInput(customFrom)
      const end = parseDateInput(customTo)
      if (!start || !end || start > end || start > today) return null
      return { start, end: end > today ? today : end }
    }
  }
}

export function BaPerformanceDashboardPage() {
  const snapshotRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [towns, setTowns] = useState<string[]>([])
  const [months, setMonths] = useState<string[]>(() => {
    const month = monthForPreset('mtd')
    return month ? [month] : []
  })
  const [stores, setStores] = useState<string[]>([])
  const [skus, setSkus] = useState<string[]>([])
  const [datePreset, setDatePreset] = useState<DatePreset>('mtd')
  const [customFrom, setCustomFrom] = useState(() => {
    const r = dateRangeForPreset('mtd', '', '')
    return r ? dateInputValue(r.start) : ''
  })
  const [customTo, setCustomTo] = useState(() => {
    const r = dateRangeForPreset('mtd', '', '')
    return r ? dateInputValue(r.end) : ''
  })
  const baTargets = useBaTargets()
  const dailyReports = useDailyReports()
  const [catalogue, setCatalogue] = useState<SkuRow[]>([])
  useEffect(() => {
    void import('../../lib/djangoSync').then(({ syncDjango }) => syncDjango())
    void syncDailyReports()
    void loadSkuCatalogue().then(setCatalogue)
  }, [])
  // Totals for the signed-in user: the server only sends their city's BAs and stores (all cities
  // for an all-cities login). The Town filter narrows them further.
  const accounts = useBaAccounts()
  const knownStores = useCreatedStores()
  const officeUser = useDjangoUser()
  const inTowns = (city: string | undefined) =>
    towns.length === 0 || towns.some((town) => town.toLowerCase() === (city ?? '').trim().toLowerCase())
  const totalAmbassadors = accounts.filter((a) => !isDemoBa(a.id) && a.isActive !== false && inTowns(a.city)).length
  const totalStores = useMemo(
    () => allStores.filter((store) => inTowns(store.city)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knownStores, towns],
  )
  const countScope = towns.length ? towns.join(', ') : officeUser?.city || 'All cities'
  const interceptions = useUserInterceptions()
  const liveRecords = useMemo(() => recordsFromTargets(baTargets, interceptions), [baTargets, interceptions])
  /** Monthly target rows, optionally narrowed to selected SKUs (target kg/units only). */
  const skuLiveRecords = useMemo(() => {
    if (!skus.length) return liveRecords
    const wanted = new Set(skus)
    const rows = baTargets.flatMap((row) => {
      const lines = (row.lines ?? []).filter((line) => wanted.has(line.sku))
      if (!lines.length) return []
      return [
        {
          ...row,
          lines,
          targetKg: lines.reduce((sum, line) => sum + line.kg, 0),
          salesKg: 0,
        },
      ]
    })
    return recordsFromTargets(rows, interceptions)
  }, [baTargets, interceptions, liveRecords, skus])
  const townOptions = useMemo(
    () => [...new Set(liveRecords.map((record) => record.town))].sort((a, b) => a.localeCompare(b)),
    [liveRecords],
  )
  const monthOptions = useMemo(() => {
    const names = new Set(liveRecords.map((record) => record.month))
    return MONTH_ORDER.filter((month) => names.has(month))
  }, [liveRecords])
  const skuOptions = useMemo(
    () =>
      [...new Set(liveRecords.flatMap((record) => record.skuSales.map((line) => line.sku)))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [liveRecords],
  )

  const range = useMemo(
    () => dateRangeForPreset(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  )

  // Load monthly BA SKU targets for every YYYY-MM touched by the active date range.
  useEffect(() => {
    if (!range) return
    let cancelled = false
    const keys: string[] = []
    for (
      let d = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      d <= range.end;
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    ) {
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    void (async () => {
      for (const month of keys) {
        if (cancelled) return
        await syncBaTargets(month)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [range])

  /** Months touched by the active date range; empty when custom dates are incomplete. */
  const coveredMonths = useMemo(() => {
    if (!range) return []
    const fromRange = monthsTouched(range.start, range.end)
    if (!months.length) return fromRange
    return fromRange.filter((month) => months.includes(month))
  }, [range, months])

  const storeOptions = useMemo(() => {
    const names = liveRecords
      .filter(
        (record) =>
          (towns.length === 0 || towns.includes(record.town)) &&
          (coveredMonths.length === 0 || coveredMonths.includes(record.month)),
      )
      .map((record) => record.store)
    return [...new Set(names)].sort((a, b) => a.localeCompare(b))
  }, [liveRecords, towns, coveredMonths])

  const scopeTown = towns.length === 0 ? null : towns.length === 1 ? towns[0] : towns.join(', ')

  /** Monthly target SKU lines per BA — same grammage source as the BA Rewards screen. */
  const targetLinesByBa = useMemo(() => {
    const map = new Map<string, { sku: string; grammage?: number }[]>()
    for (const row of baTargets) {
      if (!row.baId) continue
      const existing = map.get(row.baId) ?? []
      for (const line of row.lines ?? []) {
        existing.push({ sku: line.sku, grammage: line.grammage })
      }
      map.set(row.baId, existing)
    }
    return map
  }, [baTargets])

  /** Sales from Daily Sales reports — same unit→kg math as BA Rewards for Amna etc. */
  const salesByBa = useMemo(() => {
    if (!range) return new Map<string, { kg: number; units: number; city: string; store: string }>()
    return reportSalesInRange(dailyReports, range, {
      towns,
      stores,
      skus,
      catalogue,
      targetLinesByBa,
    })
  }, [dailyReports, range, towns, stores, skus, catalogue, targetLinesByBa])

  /**
   * Target = monthly BA SKU target table (full month).
   * Sales = daily sales report table for the selected date range (never target.salesKg).
   */
  const scopedRecords = useMemo(() => {
    if (!range) return []
    const periods = periodsForCalendarRange(range.start, range.end).filter(
      (period) => !months.length || (period.month != null && months.includes(period.month)),
    )
    const monthRows = periods.flatMap((period) => {
      if (!period.month) return []
      return filterLiveRecords(skuLiveRecords, { towns, stores, months: [period.month] }).map((record) => ({
        ...record,
        salesKg: 0,
        salesPacks: 0,
      }))
    })

    // Attach daily-report sales once per BA so multi-month ranges do not multiply sales.
    const salesApplied = new Set<string>()
    return monthRows.map((record) => {
      const key = record.baId || `${record.town}|${record.store}`
      const fromReports = record.baId ? salesByBa.get(record.baId) : undefined
      if (!fromReports) return record
      if (salesApplied.has(key)) return record
      salesApplied.add(key)
      return {
        ...record,
        salesKg: fromReports.kg,
        salesPacks: fromReports.units,
      }
    })
  }, [range, skuLiveRecords, towns, stores, months, salesByBa])

  const data = useMemo(
    () => aggregateBaPerformance(scopedRecords, scopeTown, { rankBy: 'target' }),
    [scopedRecords, scopeTown],
  )

  /** One row per ambassador (merged across months in the active filter range). */
  const targetRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        baId: string
        baName: string
        baCode?: string
        store: string
        targetKg: number
        salesKg: number
        targetPacks: number
        salesPacks: number
      }
    >()
    for (const record of scopedRecords) {
      const key = record.baId || `${record.town}|${record.store}|${record.baName ?? ''}`
      const current = grouped.get(key) ?? {
        baId: record.baId || key,
        baName: record.baName || 'Ambassador',
        baCode: record.baCode,
        store: record.store,
        targetKg: 0,
        salesKg: 0,
        targetPacks: 0,
        salesPacks: 0,
      }
      current.targetKg += record.targetKg
      current.salesKg += record.salesKg
      current.targetPacks += record.targetPacks ?? 0
      current.salesPacks += record.salesPacks ?? 0
      if (record.store && record.store !== 'Store') current.store = record.store
      if (record.baCode) current.baCode = record.baCode
      grouped.set(key, current)
    }
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        targetKg: Math.round(row.targetKg * 100) / 100,
        // Keep 3 decimals so figures match the BA Rewards card (e.g. 367.238).
        salesKg: Math.round(row.salesKg * 1000) / 1000,
        targetPacks: Math.round(row.targetPacks),
        salesPacks: Math.round(row.salesPacks),
      }))
      .sort((a, b) => a.baName.localeCompare(b.baName))
  }, [scopedRecords])

  const cityRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        stores: Set<string>
        ambassadors: Set<string>
        target: number
        sales: number
        targetUnits: number
        salesUnits: number
      }
    >()
    for (const record of scopedRecords) {
      const current = grouped.get(record.town) ?? {
        stores: new Set<string>(),
        ambassadors: new Set<string>(),
        target: 0,
        sales: 0,
        targetUnits: 0,
        salesUnits: 0,
      }
      current.stores.add(record.store)
      current.ambassadors.add(record.baId || `${record.store}|${record.baName ?? ''}`)
      current.target += record.targetKg
      current.sales += record.salesKg
      current.targetUnits += record.targetPacks ?? 0
      current.salesUnits += record.salesPacks ?? 0
      grouped.set(record.town, current)
    }
    return [...grouped.entries()]
      .map(([city, row]) => ({
        city,
        stores: row.stores.size,
        ambassadors: row.ambassadors.size,
        target: Math.round(row.target),
        sales: Math.round(row.sales * 1000) / 1000,
        targetUnits: Math.round(row.targetUnits),
        salesUnits: Math.round(row.salesUnits),
      }))
      .sort((a, b) => a.city.localeCompare(b.city))
  }, [scopedRecords])

  const [salesTrend, setSalesTrend] = useState<'wow' | 'mom' | 'yoy'>('wow')

  function applyDatePreset(preset: DatePreset) {
    setDatePreset(preset)
    if (preset === 'custom') {
      if (!customFrom && !customTo) {
        const today = todayInputValue()
        setCustomFrom(today)
        setCustomTo(today)
      }
      return
    }
    const nextRange = dateRangeForPreset(preset, '', '')
    if (nextRange) {
      setCustomFrom(dateInputValue(nextRange.start))
      setCustomTo(dateInputValue(nextRange.end))
    }
    // YTD spans many months — clear the Month sidebar filter so the range drives coverage.
    const month = monthForPreset(preset)
    setMonths(month ? [month] : [])
    setStores([])
  }

  function handleCustomFrom(value: string) {
    setCustomFrom(value)
    setDatePreset('custom')
    if (value && customTo) {
      const month = monthForPreset('custom', value, customTo)
      setMonths(month ? [month] : [])
      setStores([])
    }
  }

  function handleCustomTo(value: string) {
    setCustomTo(value)
    setDatePreset('custom')
    if (customFrom && value) {
      const month = monthForPreset('custom', customFrom, value)
      setMonths(month ? [month] : [])
      setStores([])
    }
  }

  async function downloadDashboardPdf(from: string, to: string) {
    const el = snapshotRef.current
    if (!el) throw new Error('Dashboard snapshot is not ready yet.')

    // html2canvas-pro supports Tailwind v4 oklch()/oklab() colors (plain html2canvas does not).
    const [{ default: html2canvas }, jspdfMod] = await Promise.all([
      import('html2canvas-pro'),
      import('jspdf'),
    ])
    const jsPDF = jspdfMod.jsPDF ?? jspdfMod.default

    const canvas = await html2canvas(el, {
      scale: Math.min(2, 1600 / Math.max(el.scrollWidth, 1)),
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#f8fafc',
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
    })

    if (!canvas.width || !canvas.height) {
      throw new Error('Could not capture the dashboard image.')
    }

    // Slice tall dashboards into A4 JPEG pages (smaller + more reliable than one huge image).
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 8
    const usableWidth = pageWidth - margin * 2
    const usableHeight = pageHeight - margin * 2
    const pageCanvas = document.createElement('canvas')
    const pageCtx = pageCanvas.getContext('2d')
    if (!pageCtx) throw new Error('Could not prepare PDF pages.')

    const pxPerMm = canvas.width / usableWidth
    const pageHeightPx = Math.floor(usableHeight * pxPerMm)
    let yPx = 0
    let pageIndex = 0

    while (yPx < canvas.height) {
      const sliceHeight = Math.min(pageHeightPx, canvas.height - yPx)
      pageCanvas.width = canvas.width
      pageCanvas.height = sliceHeight
      pageCtx.fillStyle = '#f8fafc'
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      pageCtx.drawImage(canvas, 0, yPx, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)
      const sliceData = pageCanvas.toDataURL('image/jpeg', 0.92)
      const sliceMm = sliceHeight / pxPerMm
      if (pageIndex > 0) pdf.addPage()
      if (pageIndex === 0) {
        pdf.setFontSize(10)
        pdf.setTextColor(51, 65, 85)
        pdf.text(`BA Performance · ${dateRangeLabel}`, margin, 5.5)
      }
      pdf.addImage(sliceData, 'JPEG', margin, margin, usableWidth, sliceMm)
      yPx += sliceHeight
      pageIndex += 1
      if (sliceHeight <= 0) break
    }

    pdf.save(`BA_Performance_${from}_to_${to}.pdf`)
  }

  async function downloadFilteredReports() {
    if (!range || downloading) return
    setDownloading(true)
    try {
      const XLSX = await import('xlsx')
      const from = dateInputValue(range.start)
      const to = dateInputValue(range.end)

      // PDF first — browsers often block a second download after Excel.
      try {
        await downloadDashboardPdf(from, to)
      } catch (pdfError) {
        console.error('[dashboard] PDF download failed:', pdfError)
        window.alert(
          pdfError instanceof Error
            ? `PDF could not be created: ${pdfError.message}`
            : 'PDF could not be created. Excel will still download.',
        )
      }

      // Brief pause so the browser treats Excel as a separate user gesture download.
      await new Promise((resolve) => window.setTimeout(resolve, 400))

      const summary = XLSX.utils.aoa_to_sheet([
        ['BA Performance Dashboard'],
        ['Date range', dateRangeLabel],
        ['From', from],
        ['To', to],
        ['Towns', towns.length ? towns.join(', ') : 'All'],
        ['Months', months.length ? months.join(', ') : coveredMonths.join(', ') || 'All'],
        ['Stores', stores.length ? stores.join(', ') : 'All'],
        ['SKUs', skus.length ? skus.join(', ') : 'All'],
        [],
        ['Metric', 'Value'],
        ['Ambassadors', totalAmbassadors],
        ['Stores', totalStores],
        ['Target (kg)', data.targetKg],
        ['Target (units)', data.targetUnits],
        ['Sales (kg)', data.salesKg],
        ['Sales (units)', data.unitsSold],
        ['Achievement (kg) %', data.achievementPct],
      ])
      summary['!cols'] = [{ wch: 22 }, { wch: 40 }]

      const byCity = XLSX.utils.aoa_to_sheet([
        ['City', 'Stores', 'Ambassadors', 'Target (kg)', 'Target (units)', 'Sales (kg)', 'Sales (units)'],
        ...cityRows.map((row) => [
          row.city,
          row.stores,
          row.ambassadors,
          row.target,
          row.targetUnits,
          row.sales,
          row.salesUnits,
        ]),
      ])
      byCity['!cols'] = [16, 10, 12, 12, 14, 12, 14].map((wch) => ({ wch }))

      const byStoreMap = new Map<
        string,
        { town: string; targetKg: number; salesKg: number; targetUnits: number; salesUnits: number }
      >()
      for (const record of scopedRecords) {
        const key = `${record.town}|${record.store}`
        const cur = byStoreMap.get(key) ?? {
          town: record.town,
          targetKg: 0,
          salesKg: 0,
          targetUnits: 0,
          salesUnits: 0,
        }
        cur.targetKg += record.targetKg
        cur.salesKg += record.salesKg
        cur.targetUnits += record.targetPacks ?? 0
        cur.salesUnits += record.salesPacks ?? 0
        byStoreMap.set(key, cur)
      }
      const byStore = XLSX.utils.aoa_to_sheet([
        ['City', 'Store', 'Target (kg)', 'Target (units)', 'Sales (kg)', 'Sales (units)', 'Achievement %'],
        ...[...byStoreMap.entries()]
          .map(([key, row]) => {
            const store = key.split('|').slice(1).join('|')
            const pct = row.targetKg > 0 ? Math.round((row.salesKg / row.targetKg) * 100) : 0
            return [
              row.town,
              store,
              Math.round(row.targetKg * 10) / 10,
              Math.round(row.targetUnits),
              Math.round(row.salesKg * 10) / 10,
              Math.round(row.salesUnits),
              pct,
            ]
          })
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))),
      ])
      byStore['!cols'] = [14, 28, 12, 14, 12, 14, 14].map((wch) => ({ wch }))

      const skuMap = new Map<string, number>()
      for (const record of scopedRecords) {
        for (const line of record.skuSales) {
          skuMap.set(line.sku, (skuMap.get(line.sku) ?? 0) + line.sales)
        }
      }
      const bySku = XLSX.utils.aoa_to_sheet([
        ['SKU', 'Sales (kg)'],
        ...[...skuMap.entries()]
          .map(([sku, sales]) => [sku, Math.round(sales * 10) / 10])
          .sort((a, b) => Number(b[1]) - Number(a[1])),
      ])
      bySku['!cols'] = [{ wch: 36 }, { wch: 12 }]

      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, summary, 'Summary')
      XLSX.utils.book_append_sheet(book, byCity, 'By city')
      XLSX.utils.book_append_sheet(book, byStore, 'By store')
      XLSX.utils.book_append_sheet(book, bySku, 'By SKU')
      XLSX.writeFile(book, `BA_Performance_${from}_to_${to}.xlsx`)
    } catch (error) {
      console.error('[dashboard] download failed:', error)
      window.alert(error instanceof Error ? error.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  function handleTownChange(next: string[]) {
    setTowns(next)
    setStores([])
  }

  function handleMonthChange(next: string[]) {
    setMonths(next)
    setStores([])
    setDatePreset('custom')
    // Months picked by hand replace any date range. The span runs from the earliest
    // selected month to the latest; unselected months inside that span stay excluded.
    if (next.length) {
      const { from, to } = dateRangeForMonths(next)
      setCustomFrom(from)
      setCustomTo(to)
    } else {
      setCustomFrom('')
      setCustomTo('')
    }
  }

  const dateRangeLabel = useMemo(() => {
    if (datePreset === 'custom' && customFrom && customTo) {
      return `${customFrom} → ${customTo}`
    }
    const label = DATE_PRESETS.find((p) => p.id === datePreset)?.label ?? ''
    if ((datePreset === 'today' || datePreset === 'yesterday') && range) {
      return `${label} · ${range.start.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    return label
  }, [datePreset, customFrom, customTo, range])

  const scopeLabel = data.townTargetVsSales.town

  const categoryChart = useMemo<ChartData<'doughnut'>>(() => {
    const totals = { Danedar: 0, 'Family Mixture': 0, 'Tea bags': 0, Other: 0 }
    for (const record of scopedRecords) {
      for (const line of record.skuSales) {
        const sku = line.sku.toLowerCase()
        const tea = sku.includes('tea bag') || sku.includes('rtb')
        const name = tea
          ? 'Tea bags'
          : sku.includes('family')
            ? 'Family Mixture'
            : sku.includes('danedar')
              ? 'Danedar'
              : 'Other'
        totals[name] += line.sales
      }
    }
    const entries = (Object.entries(totals) as [string, number][]).filter(([, value]) => value > 0)
    return {
      labels: entries.map(([name]) => name),
      datasets: [
        {
          data: entries.map(([, value]) => Math.round(value)),
          backgroundColor: [...categoryColors, '#94a3b8'],
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    }
  }, [scopedRecords])

  const categoryOptions = useMemo<ChartOptions<'doughnut'>>(
    () => ({
      ...defaultChartOptions,
      plugins: {
        ...defaultChartOptions.plugins,
        legend: { ...defaultChartOptions.plugins.legend, position: 'bottom' },
      },
      cutout: '55%',
    }),
    [],
  )

  const targetSalesChart = useMemo<ChartData<'bar'>>(
    () => ({
      labels: ['Target', 'Sales'],
      datasets: [
        {
          data: [data.townTargetVsSales.target, data.townTargetVsSales.sales],
          backgroundColor: [chartGreenLight, chartGreen],
          borderRadius: 4,
          maxBarThickness: 48,
        },
      ],
    }),
    [data.townTargetVsSales],
  )

  const targetSalesOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      ...defaultChartOptions,
      plugins: { ...defaultChartOptions.plugins, legend: { display: false } },
      scales: {
        x: scaleDefaults,
        y: { ...scaleDefaults, beginAtZero: true },
      },
    }),
    [],
  )

  const trendRecords = useMemo(() => {
    if (salesTrend === 'wow') return scopedRecords
    const monthsForTrend = monthOptions
    if (!range) return []
    const periods = periodsForCalendarRange(range.start, range.end).filter(
      (period) => period.month != null && monthsForTrend.includes(period.month),
    )
    // MoM / YoY: use full months inside the selected year span (sales from target rows / reports).
    if (salesTrend === 'mom' || salesTrend === 'yoy') {
      return filterLiveRecords(skuLiveRecords, {
        towns,
        stores,
        months: periods.map((p) => p.month!).filter(Boolean),
      })
    }
    return scopedRecords
  }, [salesTrend, scopedRecords, monthOptions, skuLiveRecords, towns, stores, range])

  const trendSeries = useMemo(() => {
    if (salesTrend === 'wow') {
      const buckets = new Map<string, { sales: number; target: number; order: number }>()
      for (const record of trendRecords) {
        const weeks = [...record.weekSales].sort((a, b) => a.week - b.week)
        if (!weeks.length) continue
        const weekTarget = record.targetKg / weeks.length
        const monthIndex = MONTH_ORDER.indexOf(record.month)
        for (const week of weeks) {
          const key = `${record.month.slice(0, 3)} W${week.week}`
          const current = buckets.get(key) ?? { sales: 0, target: 0, order: monthIndex * 10 + week.week }
          current.sales += week.sales
          current.target += weekTarget
          buckets.set(key, current)
        }
      }
      const points = [...buckets.entries()].sort((a, b) => a[1].order - b[1].order)
      return {
        labels: points.map(([label]) => label),
        sales: points.map(([, point]) => Math.round(point.sales * 10) / 10),
        target: points.map(([, point]) => Math.round(point.target * 10) / 10),
      }
    }

    const buckets = new Map<string, { sales: number; target: number }>()
    for (const record of trendRecords) {
      const current = buckets.get(record.month) ?? { sales: 0, target: 0 }
      current.sales += record.salesKg
      current.target += record.targetKg
      buckets.set(record.month, current)
    }
    const points = monthOptions
      .filter((month) => buckets.has(month))
      .map((month) => ({ month, ...buckets.get(month)! }))
    if (salesTrend === 'yoy') {
      let sales = 0
      let target = 0
      return {
        labels: points.map((point) => point.month.slice(0, 3)),
        sales: points.map((point) => {
          sales += point.sales
          return Math.round(sales * 10) / 10
        }),
        target: points.map((point) => {
          target += point.target
          return Math.round(target * 10) / 10
        }),
      }
    }
    return {
      labels: points.map((point) => point.month.slice(0, 3)),
      sales: points.map((point) => Math.round(point.sales * 10) / 10),
      target: points.map((point) => Math.round(point.target * 10) / 10),
    }
  }, [trendRecords, salesTrend, monthOptions])

  const weekChart = useMemo<ChartData<'line'>>(
    () => ({
      labels: trendSeries.labels,
      datasets: [
        {
          label: 'Sales',
          data: trendSeries.sales,
          borderColor: chartGreen,
          backgroundColor: chartGreen,
          pointBackgroundColor: chartGreen,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.35,
          borderWidth: 2,
        },
        {
          label: 'Target',
          data: trendSeries.target,
          borderColor: chartGold,
          backgroundColor: chartGold,
          pointBackgroundColor: chartGold,
          pointRadius: 2,
          borderDash: [5, 4],
          borderWidth: 2,
          tension: 0.25,
        },
      ],
    }),
    [trendSeries],
  )

  const weekOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      ...defaultChartOptions,
      plugins: {
        ...defaultChartOptions.plugins,
        legend: { ...defaultChartOptions.plugins.legend, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
      },
      scales: {
        x: scaleDefaults,
        y: { ...scaleDefaults, beginAtZero: true },
      },
    }),
    [],
  )

  const topStoresChart = useMemo<ChartData<'bar'>>(
    () => ({
      labels: data.topStores.map((s) => s.store),
      datasets: [
        {
          data: data.topStores.map((s) => s.sales),
          backgroundColor: chartGreenLight,
          borderRadius: 3,
          maxBarThickness: 18,
        },
      ],
    }),
    [data.topStores],
  )

  const topSkusChart = useMemo<ChartData<'bar'>>(
    () => ({
      labels: data.topSkus.map((s) => s.sku),
      datasets: [
        {
          data: data.topSkus.map((s) => s.sales),
          backgroundColor: chartGreenLight,
          borderRadius: 3,
          maxBarThickness: 18,
        },
      ],
    }),
    [data.topSkus],
  )

  const horizontalBarOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      ...defaultChartOptions,
      indexAxis: 'y',
      plugins: { ...defaultChartOptions.plugins, legend: { display: false } },
      scales: {
        x: { ...scaleDefaults, beginAtZero: true },
        y: {
          ...scaleDefaults,
          ticks: { ...scaleDefaults.ticks, font: { size: 9 } },
        },
      },
    }),
    [],
  )

  return (
    <div className="space-y-5">
      <Card className="!p-3 sm:!p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
              Date range
            </div>
            <div className="text-xs text-slate-400">{dateRangeLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyDatePreset(p.id)}
                className={cn(
                  'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition',
                  datePreset === p.id
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {p.label}
              </button>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!range || downloading}
              onClick={() => void downloadFilteredReports()}
            >
              <Download size={14} />
              {downloading ? 'Preparing…' : 'Download'}
            </Button>
          </div>
        </div>
        {datePreset === 'custom' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-600">From</span>
              <input
                type="date"
                max={todayInputValue()}
                value={customFrom}
                onChange={(e) => handleCustomFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-600">To</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                max={todayInputValue()}
                onChange={(e) => handleCustomTo(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
          </div>
        )}
        {!range && datePreset === 'custom' && (
          <p className="mt-2 text-xs text-amber-700">Choose a valid From / To range (From ≤ To, not after today).</p>
        )}
      </Card>

      <div ref={snapshotRef} className="space-y-5 bg-slate-50">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Ambassadors" value={totalAmbassadors.toLocaleString()} hint={countScope} />
        <KpiCard label="Stores" value={totalStores.toLocaleString()} hint={countScope} />
        <KpiCard label="Target (kg)" value={data.targetKg.toLocaleString()} />
        <KpiCard label="Target (units)" value={data.targetUnits.toLocaleString()} />
        <KpiCard label="Sales (kg)" value={data.salesKg.toLocaleString()} />
        <KpiCard label="Sales (units)" value={data.unitsSold.toLocaleString()} />
        <KpiCard label="Achievement (kg)" value={`${data.achievementPct}%`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:grid-rows-[auto_auto]">
        <aside className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col">
          <FilterPanel title="Town" options={townOptions} value={towns} onChange={handleTownChange} />
          <FilterPanel title="Month" options={monthOptions} value={months} onChange={handleMonthChange} />
          <FilterPanel title="Store" options={storeOptions} value={stores} onChange={setStores} />
          <FilterPanel title="SKU List" options={skuOptions} value={skus} onChange={setSkus} fill />
        </aside>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-start-2 lg:row-start-1 lg:items-stretch">
          <ChartCard title="Category-wise target">
            <Doughnut data={categoryChart} options={categoryOptions} />
          </ChartCard>

          <ChartCard title={`Target vs sales — ${scopeLabel}`}>
            <Bar data={targetSalesChart} options={targetSalesOptions} />
          </ChartCard>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-start-2 lg:row-start-2 lg:grid-cols-3 lg:items-stretch">
          <ChartCard
            title={
              salesTrend === 'wow'
                ? 'Week-wise target (units)'
                : salesTrend === 'mom'
                  ? 'Month-wise target (units)'
                  : 'Year-to-date target (units)'
            }
            action={
              <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                {(
                  [
                    ['wow', 'WoW'],
                    ['mom', 'MoM'],
                    ['yoy', 'YoY'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSalesTrend(id)}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] font-semibold transition',
                      salesTrend === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            <Line data={weekChart} options={weekOptions} />
          </ChartCard>

          <ChartCard title="Top 10 stores by target" plotClassName="h-[320px]">
            <Bar data={topStoresChart} options={horizontalBarOptions} />
          </ChartCard>

          <ChartCard title="Top 10 SKU targets" plotClassName="h-[320px]">
            <Bar data={topSkusChart} options={horizontalBarOptions} />
          </ChartCard>
        </div>
      </div>

      <Card padding={false}>
        <div className="border-b border-slate-50 px-4 py-3 sm:px-5">
          <CardHeader
            title="Target vs achievement"
            subtitle={`${dateRangeLabel} · Target from monthly BA SKU targets · Sales from daily sales reports`}
          />
        </div>
        <TableScroll minWidth={640}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Ambassador</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Target (kg)</th>
                <th className="px-4 py-3">Target (units)</th>
                <th className="px-4 py-3">Sales (kg)</th>
                <th className="px-4 py-3">Sales (units)</th>
                <th className="px-4 py-3">Achievement (kg)</th>
              </tr>
            </thead>
            <tbody>
              {targetRows.map((row) => {
                const pct = achievementPct(row.targetKg, row.salesKg)
                return (
                  <tr key={row.baId} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div>{row.baName}</div>
                      {row.baCode && <div className="text-xs text-slate-400">{row.baCode}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.store || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{row.targetKg.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums">{row.targetPacks.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums">{row.salesKg.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums">{row.salesPacks.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          pct >= 100
                            ? 'font-semibold text-emerald-600'
                            : pct >= 80
                              ? 'font-semibold text-amber-600'
                              : 'font-semibold text-rose-600'
                        }
                      >
                        {pct}%
                      </span>
                    </td>
                  </tr>
                )
              })}
              {targetRows.length === 0 && <EmptyRow cols={7} />}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card padding={false}>
        <div className="border-b border-slate-50 px-4 py-3 sm:px-5">
          <CardHeader
            title="Targets by city"
            subtitle={`${dateRangeLabel} · Target from monthly BA SKU targets · Sales from daily sales reports`}
          />
        </div>
        <TableScroll minWidth={520}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Stores</th>
                <th className="px-4 py-3">Ambassadors</th>
                <th className="px-4 py-3">Target (kg)</th>
                <th className="px-4 py-3">Target (units)</th>
                <th className="px-4 py-3">Sales (kg)</th>
                <th className="px-4 py-3">Sales (units)</th>
              </tr>
            </thead>
            <tbody>
              {cityRows.map((row) => (
                <tr key={row.city} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{row.city}</td>
                  <td className="px-4 py-3 text-slate-600">{row.stores}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.ambassadors}</td>
                  <td className="px-4 py-3 tabular-nums">{row.target.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums">{row.targetUnits.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums">{row.sales.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums">{row.salesUnits.toLocaleString()}</td>
                </tr>
              ))}
              {cityRows.length === 0 && <EmptyRow cols={7} />}
            </tbody>
          </table>
        </TableScroll>
      </Card>
      </div>
    </div>
  )
}
