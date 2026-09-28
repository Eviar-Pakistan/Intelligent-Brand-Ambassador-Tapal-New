import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { RotateCcw, Search } from 'lucide-react'
import { EarlyCheckoutsCard } from '../../components/EarlyCheckoutsCard'
import { Card, CardHeader, cn, KpiCard, TableScroll } from '../../components/ui'
import {
  aggregateBaPerformance,
  applySkuFilter,
  MONTH_ORDER,
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
import {
  achievementPct,
  currentMonthKey,
  formatTargetMonth,
  useBaTargets,
} from '../../lib/baTargets'
import { syncBaTargets } from '../../lib/djangoSync'

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
  useEffect(() => {
    void syncBaTargets()
  }, [])
  const targetMonths = useMemo(() => {
    const keys = new Set(baTargets.map((row) => row.month))
    keys.add(currentMonthKey())
    return [...keys].sort((a, b) => b.localeCompare(a))
  }, [baTargets])
  const [targetMonth, setTargetMonth] = useState(currentMonthKey)
  const targetRows = useMemo(
    () =>
      baTargets
        .filter((row) => row.month === targetMonth)
        .slice()
        .sort((a, b) => a.baName.localeCompare(b.baName)),
    [baTargets, targetMonth],
  )
  const liveRecords = useMemo(() => recordsFromTargets(baTargets), [baTargets])
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

  const coveredMonths = useMemo(() => {
    const fromRange = range ? monthsTouched(range.start, range.end) : months
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

  const scopedRecords = useMemo(
    () => applySkuFilter(filterLiveRecords(liveRecords, { towns, stores, months: coveredMonths }), skus),
    [liveRecords, towns, stores, coveredMonths, skus],
  )

  const data = useMemo(
    () => aggregateBaPerformance(scopedRecords, scopeTown, { rankBy: 'target' }),
    [scopedRecords, scopeTown],
  )

  const cityRows = useMemo(() => {
    const grouped = new Map<string, { stores: Set<string>; ambassadors: number; target: number; sales: number }>()
    for (const record of scopedRecords) {
      const current = grouped.get(record.town) ?? {
        stores: new Set<string>(),
        ambassadors: 0,
        target: 0,
        sales: 0,
      }
      current.stores.add(record.store)
      current.ambassadors += 1
      current.target += record.targetKg
      current.sales += record.salesKg
      grouped.set(record.town, current)
    }
    return [...grouped.entries()]
      .map(([city, row]) => ({
        city,
        stores: row.stores.size,
        ambassadors: row.ambassadors,
        target: Math.round(row.target),
        sales: Math.round(row.sales * 10) / 10,
      }))
      .sort((a, b) => a.city.localeCompare(b.city))
  }, [scopedRecords])

  const [salesTrend, setSalesTrend] = useState<'wow' | 'mom' | 'yoy'>('wow')

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
    const monthsForTrend = salesTrend === 'wow' ? coveredMonths : monthOptions
    return applySkuFilter(filterLiveRecords(liveRecords, { towns, stores, months: monthsForTrend }), skus)
  }, [salesTrend, coveredMonths, monthOptions, liveRecords, towns, stores, skus])

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
      <EarlyCheckoutsCard />
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Ambassadors" value={scopedRecords.length.toLocaleString()} hint="September targets" />
        <KpiCard label="Stores" value={new Set(scopedRecords.map((record) => record.store)).size.toLocaleString()} />
        <KpiCard label="Target (units)" value={data.targetUnits.toLocaleString()} />
        <KpiCard label="Sales (units)" value={data.unitsSold.toLocaleString()} />
        <KpiCard label="Achievement" value={`${data.achievementPct}%`} />
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-4 py-3 sm:px-5">
          <CardHeader
            title="Target vs achievement"
            subtitle="September 2026 targets saved for each store's ambassador"
          />
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
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Target (units)</th>
                <th className="px-4 py-3">Sales (units)</th>
                <th className="px-4 py-3">Achievement</th>
              </tr>
            </thead>
            <tbody>
              {targetRows.map((row) => {
                const pct = achievementPct(row.targetKg, row.salesKg)
                return (
                  <tr key={`${row.baId}-${row.month}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div>{row.baName}</div>
                      {row.baCode && <div className="text-xs text-slate-400">{row.baCode}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.storeName || '—'}</td>
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
              {targetRows.length === 0 && <EmptyRow cols={5} />}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card padding={false}>
        <div className="border-b border-slate-50 px-4 py-3 sm:px-5">
          <CardHeader title="Targets by city" subtitle={dateRangeLabel} />
        </div>
        <TableScroll minWidth={520}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Stores</th>
                <th className="px-4 py-3">Ambassadors</th>
                <th className="px-4 py-3">Target (units)</th>
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
                  <td className="px-4 py-3 tabular-nums">{row.sales.toLocaleString()}</td>
                </tr>
              ))}
              {cityRows.length === 0 && <EmptyRow cols={5} />}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  )
}
