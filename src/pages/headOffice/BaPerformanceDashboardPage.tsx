import { useMemo, useState, type ReactNode } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { FileSpreadsheet, RotateCcw, Search } from 'lucide-react'
import { Button, Card, CardHeader, cn, KpiCard, StatusBadge, TableScroll } from '../../components/ui'
import { BulkTargetModal } from './AmbassadorPages'
import {
  aggregateBaPerformance,
  applySkuFilter,
  baPerformanceMonths,
  baPerformanceSkus,
  baPerformanceTowns,
  collectPeriodRecords,
  getStoresForTown,
  MONTH_ORDER,
  periodsForRange,
  type DataPeriod,
} from '../../data/baPerformance'
import {
  attendanceForRange,
  attendanceRows,
  baCities,
  baStatusByCity,
  daysInRange,
  workingHoursSeries,
} from '../../data/baAttendance'
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
import {
  achievementPct,
  currentMonthKey,
  formatTargetMonth,
  useBaTargets,
} from '../../lib/baTargets'

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
  const [towns, setTowns] = useState<string[]>([])
  const [months, setMonths] = useState<string[]>(() => {
    const month = monthForPreset('mtd')
    return month ? [month] : []
  })
  const [stores, setStores] = useState<string[]>([])
  const [skus, setSkus] = useState<string[]>([])
  const [datePreset, setDatePreset] = useState<DatePreset>('mtd')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const baTargets = useBaTargets()
  const targetMonths = useMemo(() => {
    const keys = new Set(baTargets.map((row) => row.month))
    keys.add(currentMonthKey())
    return [...keys].sort((a, b) => b.localeCompare(a))
  }, [baTargets])
  const [targetMonth, setTargetMonth] = useState(currentMonthKey)
  const [targetUploadOpen, setTargetUploadOpen] = useState(false)
  const targetRows = useMemo(
    () =>
      baTargets
        .filter((row) => row.month === targetMonth)
        .slice()
        .sort((a, b) => a.baName.localeCompare(b.baName)),
    [baTargets, targetMonth],
  )

  const range = useMemo(
    () => dateRangeForPreset(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  )

  // Performance data is monthly. A valid date range picks the months (and days of each month)
  // it covers; otherwise the Month panel decides (one month, or all months when empty).
  const rangePeriods = useMemo(
    () => (range ? periodsForRange(range.start, range.end) : null),
    [range],
  )
  const periods = useMemo<DataPeriod[]>(() => {
    const base = rangePeriods?.periods ?? (months.length ? months.map((month) => ({ month, share: null })) : [{ month: null, share: null }])
    if (!months.length) return base
    return base.filter((period) => period.month !== null && months.includes(period.month))
  }, [rangePeriods, months])
  const storeOptions = useMemo(
    () =>
      getStoresForTown(
        towns,
        periods.some((p) => p.month === null) ? null : periods.map((p) => p.month as string),
      ),
    [towns, periods],
  )

  const scopeTown = towns.length === 0 ? null : towns.length === 1 ? towns[0] : towns.join(', ')

  const data = useMemo(
    () =>
      aggregateBaPerformance(
        applySkuFilter(collectPeriodRecords({ towns, stores }, periods), skus),
        scopeTown,
      ),
    [towns, stores, periods, skus, scopeTown],
  )

  // Town/Store filters narrow attendance the same way they narrow sales — by matching the
  // BA's city/store. Attendance is a separate mock dataset from the sales stores, so a town
  // or store with no attendance records simply shows no data, same as sales.
  const attendance = useMemo(() => {
    const all = range ? attendanceForRange(range) : []
    return all.filter(
      (r) =>
        (towns.length === 0 || towns.includes(r.city)) &&
        (stores.length === 0 || stores.includes(r.store)) &&
        (months.length === 0 || months.includes(MONTH_ORDER[r.date.getMonth()])),
    )
  }, [range, towns, stores, months])
  const cityStatus = useMemo(
    () => (range ? baStatusByCity(range, { cities: towns, stores, months }) : null),
    [range, towns, stores, months],
  )
  const isSingleDay = range ? daysInRange(range) === 1 : false
  const attendanceTable = useMemo(
    () => attendanceRows(attendance, isSingleDay),
    [attendance, isSingleDay],
  )
  const [hoursCities, setHoursCities] = useState<string[]>([])
  const [salesTrend, setSalesTrend] = useState<'wow' | 'mom' | 'yoy'>('wow')
  const workingHours = useMemo(
    () => (range ? workingHoursSeries(attendance, range, hoursCities) : null),
    [attendance, range, hoursCities],
  )

  function applyDatePreset(preset: DatePreset, from = customFrom, to = customTo) {
    setDatePreset(preset)
    if (preset === 'custom') return
    const month = monthForPreset(preset, from, to)
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

  function toggleHoursCity(city: string) {
    setHoursCities((current) =>
      current.includes(city) ? current.filter((item) => item !== city) : [...current, city],
    )
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

  const baStatusHint = !cityStatus
    ? 'Select a valid date range'
    : cityStatus.days > 1
      ? `Avg per day · ${cityStatus.days} days`
      : undefined

  const scopeLabel = data.townTargetVsSales.town

  const categoryChart = useMemo<ChartData<'doughnut'>>(
    () => ({
      labels: data.categorySales.map((c) => c.name),
      datasets: [
        {
          data: data.categorySales.map((c) => c.value),
          backgroundColor: categoryColors,
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    }),
    [data.categorySales],
  )

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
    const periodList: DataPeriod[] =
      salesTrend === 'wow'
        ? periods
        : baPerformanceMonths.map((month) => ({ month, share: null }))
    return applySkuFilter(collectPeriodRecords({ towns, stores }, periodList), skus)
  }, [salesTrend, periods, towns, stores, skus])

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
    const points = baPerformanceMonths
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
  }, [trendRecords, salesTrend])

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

  const workingHoursChart = useMemo<ChartData<'bar'>>(
    () => ({
      labels: workingHours?.points.map((p) => p.label) ?? [],
      datasets: [
        {
          label: 'Avg working hours',
          data: workingHours?.points.map((p) => p.hours) ?? [],
          backgroundColor: chartGreen,
          borderRadius: 4,
          maxBarThickness: 36,
        },
      ],
    }),
    [workingHours],
  )

  const workingHoursOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      ...defaultChartOptions,
      plugins: {
        ...defaultChartOptions.plugins,
        legend: { display: false },
        tooltip: {
          ...defaultChartOptions.plugins.tooltip,
          displayColors: false,
          callbacks: {
            label: (ctx) => {
              const visits = workingHours?.points[ctx.dataIndex]?.count ?? 0
              return `${ctx.parsed.y} h avg · ${visits} ${visits === 1 ? 'visit' : 'visits'}`
            },
          },
        },
      },
      scales: {
        x: scaleDefaults,
        y: {
          ...scaleDefaults,
          beginAtZero: true,
          ticks: { ...scaleDefaults.ticks, callback: (v) => `${v}h` },
        },
      },
    }),
    [workingHours],
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
          <div className="flex flex-wrap gap-1.5">
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
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Active BAs" value={cityStatus?.active ?? '—'} hint={baStatusHint} />
        <KpiCard label="Offline BAs" value={cityStatus?.offline ?? '—'} hint={baStatusHint} />
        <KpiCard label="On Break BAs" value={cityStatus?.break ?? '—'} hint={baStatusHint} />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Customers Intercepted" value={data.customersIntercepted.toLocaleString()} />
        <KpiCard label="Productive Calls" value={data.productiveCalls.toLocaleString()} />
        <KpiCard label="Productive %" value={`${data.productivePct}%`} />
        <KpiCard label="Achievement" value={`${data.achievementPct}%`} />
        <KpiCard label="Target (Kg)" value={data.targetKg.toLocaleString()} />
        <KpiCard label="Sales (Kg)" value={data.salesKg.toLocaleString()} />
        <KpiCard label="Target (Units)" value={data.targetUnits.toLocaleString()} />
        <KpiCard label="Units sold" value={data.unitsSold.toLocaleString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:grid-rows-[auto_auto]">
        <aside className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col">
          <FilterPanel title="Town" options={baPerformanceTowns} value={towns} onChange={handleTownChange} />
          <FilterPanel title="Month" options={baPerformanceMonths} value={months} onChange={handleMonthChange} />
          <FilterPanel title="Store" options={storeOptions} value={stores} onChange={setStores} />
          <FilterPanel title="SKU List" options={baPerformanceSkus} value={skus} onChange={setSkus} fill />
        </aside>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-start-2 lg:row-start-1 lg:items-stretch">
          <ChartCard title="Category-wise sales">
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
                ? 'Week-wise sales (Kg)'
                : salesTrend === 'mom'
                  ? 'Month-wise sales (Kg)'
                  : 'Year-to-date sales (Kg)'
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

          <ChartCard title="Top 10 stores" plotClassName="h-[320px]">
            <Bar data={topStoresChart} options={horizontalBarOptions} />
          </ChartCard>

          <ChartCard title="Top 10 SKUs" plotClassName="h-[320px]">
            <Bar data={topSkusChart} options={horizontalBarOptions} />
          </ChartCard>
        </div>
      </div>

      <Card padding={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-4 py-3 sm:px-5">
          <CardHeader
            title="Target vs achievement"
            subtitle="Ambassador target and sales set by Head Office"
          />
          <Button size="sm" variant="secondary" onClick={() => setTargetUploadOpen(true)}>
            <FileSpreadsheet size={14} /> Upload targets
          </Button>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            Month
            <select
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-500"
            >
              {targetMonths.map((month) => (
                <option key={month} value={month}>
                  {formatTargetMonth(month)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <TableScroll minWidth={640}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Ambassador</th>
                <th className="px-4 py-3">Target (Kg)</th>
                <th className="px-4 py-3">Sales (Kg)</th>
                <th className="px-4 py-3">Achievement</th>
              </tr>
            </thead>
            <tbody>
              {targetRows.map((row) => {
                const pct = achievementPct(row.targetKg, row.salesKg)
                return (
                  <tr key={`${row.baId}-${row.month}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.baName}</td>
                    <td className="px-4 py-3 tabular-nums">{row.targetKg.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums">{row.salesKg.toLocaleString()}</td>
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
              {targetRows.length === 0 && <EmptyRow cols={4} />}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card padding={false}>
        <div className="border-b border-slate-50 px-4 py-3 sm:px-5">
          <CardHeader
            title="Active BAs by city"
            subtitle={
              cityStatus && cityStatus.days > 1
                ? `${dateRangeLabel} · average per day`
                : dateRangeLabel
            }
          />
        </div>
        <TableScroll minWidth={520}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Stores</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Break</th>
                <th className="px-4 py-3">Offline</th>
                <th className="px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {(cityStatus?.cities ?? []).map((row) => (
                <tr key={row.city} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{row.city}</td>
                  <td className="px-4 py-3 text-slate-600">{row.stores}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-600">{row.active}</td>
                  <td className="px-4 py-3 text-amber-600">{row.break}</td>
                  <td className="px-4 py-3 text-slate-500">{row.offline}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.total}</td>
                </tr>
              ))}
              {!cityStatus && <EmptyRow cols={6} />}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card padding={false}>
        <div className="border-b border-slate-50 px-4 py-3 sm:px-5">
          <CardHeader
            title="BA check-in / check-out"
            subtitle={isSingleDay ? `Store-wise · ${dateRangeLabel}` : `Per BA average · ${dateRangeLabel}`}
          />
        </div>
        <TableScroll minWidth={720}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">BA</th>
                <th className="px-4 py-3">Store</th>
                {!isSingleDay && <th className="px-4 py-3">Days worked</th>}
                <th className="px-4 py-3">{isSingleDay ? 'Check-in' : 'Avg check-in'}</th>
                <th className="px-4 py-3">{isSingleDay ? 'Check-out' : 'Avg check-out'}</th>
                <th className="px-4 py-3">{isSingleDay ? 'Working hrs' : 'Avg working hrs'}</th>
                {isSingleDay && <th className="px-4 py-3">Status</th>}
              </tr>
            </thead>
            <tbody>
              {attendanceTable.map((row) => (
                <tr key={`${row.ba}-${row.store}-${row.checkIn}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{row.ba}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{row.store}</div>
                    <div className="text-xs text-slate-400">{row.city}</div>
                  </td>
                  {!isSingleDay && <td className="px-4 py-3 tabular-nums">{row.days}</td>}
                  <td className="px-4 py-3 tabular-nums">{row.checkIn}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{row.checkOut}</td>
                  <td className="px-4 py-3 tabular-nums">{row.hours.toFixed(1)} h</td>
                  {isSingleDay && (
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status ?? ''} />
                    </td>
                  )}
                </tr>
              ))}
              {attendanceTable.length === 0 && <EmptyRow cols={6} />}
            </tbody>
          </table>
        </TableScroll>
      </Card>


      <Card>
        <CardHeader
          title="Average working hours"
          subtitle={`${dateRangeLabel} · ${
            !workingHours
              ? 'select a valid date range'
              : workingHours.avgHours === null
                ? 'no attendance for this selection'
                : `overall average ${workingHours.avgHours} h per BA visit${
                    range && range.end.toDateString() === new Date().toDateString()
                      ? ' (today counted up to now)'
                      : ''
                  }`
          }`}
          action={
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium text-slate-500">
                City{hoursCities.length === 0 ? ' · All' : ''}
              </span>
              {baCities.map((city) => {
                const selected = hoursCities.includes(city)
                return (
                  <button
                    key={city}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleHoursCity(city)}
                    className={cn(
                      'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition',
                      selected
                        ? 'bg-brand-500 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    )}
                  >
                    {city}
                  </button>
                )
              })}
            </div>
          }
        />
        <div className="relative h-56 sm:h-72">
          {workingHours && workingHours.points.length > 0 ? (
            <Bar data={workingHoursChart} options={workingHoursOptions} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              No data to show
            </div>
          )}
        </div>
      </Card>
      <BulkTargetModal open={targetUploadOpen} onClose={() => setTargetUploadOpen(false)} />
    </div>
  )
}
