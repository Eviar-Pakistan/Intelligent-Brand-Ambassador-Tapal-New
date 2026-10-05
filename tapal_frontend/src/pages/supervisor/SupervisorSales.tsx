import { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/ui'
import { achievementPct, currentMonthKey, formatTargetMonth, type BaMonthTarget, type TargetLine } from '../../lib/baTargets'
import { portalGet } from '../../lib/serverApi'
import { labeledSales, useDailyReports, type StoredDailyReport } from '../../lib/baReport'
import { loadSkuCatalogue, type SkuRow } from '../../lib/skuCatalogue'
import { supervisorOverview, type Supervisor } from '../../lib/supervisors'

type TargetRow = BaMonthTarget & { id: number }

const num = (value: number, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits })

type Period = 'today' | 'yesterday' | 'last7' | 'month'
type SaleLine = { sku: string; kg: number; units: number }
type SalesSummary = { kg: number; units: number; items: SaleLine[] }

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateBounds(period: Period) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1)
    end.setDate(end.getDate() - 1)
  }
  if (period === 'last7') start.setDate(start.getDate() - 6)
  if (period === 'month') start.setDate(1)
  return { start, end }
}

function packKg(sku: string, catalogue: SkuRow[], lines: TargetLine[]) {
  const key = sku.trim().toLowerCase()
  const grams = lines.find((line) => line.sku.trim().toLowerCase() === key)?.grammage ??
    catalogue.find((line) => line.sku.trim().toLowerCase() === key)?.grammage
  if (grams && grams > 0) return grams
  const carton = /(?:^|\s)(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|gram)\b/i.exec(sku)
  if (carton) return Number(carton[1]) * Number(carton[2]) * (/^kg$/i.test(carton[3]) ? 1 : 0.001)
  const size = /(\d+(?:\.\d+)?)\s*(kg|g|gm|gram)\b/i.exec(sku)
  return size ? Number(size[1]) * (/^kg$/i.test(size[2]) ? 1 : 0.001) : 0
}

function summarizeSales(reports: StoredDailyReport[], baId: string, period: Period, catalogue: SkuRow[], targetLines: TargetLine[]): SalesSummary {
  const { start, end } = dateBounds(period)
  const byDay = new Map<string, StoredDailyReport>()
  for (const report of [...reports].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (report.baId !== baId) continue
    const key = dayKey(new Date(report.submittedAt))
    if (key < dayKey(start) || key > dayKey(end)) continue
    const lines = labeledSales(report.sales).filter((line) => line.section.toLowerCase().includes('sales'))
    if (report.source === 'checkout' || (report.source === 'excel' && lines.some((line) => Number(line.value) > 0))) byDay.set(key, report)
  }
  const items = new Map<string, SaleLine>()
  for (const report of byDay.values()) {
    for (const line of labeledSales(report.sales).filter((row) => row.section.toLowerCase().includes('sales'))) {
      const amount = Number(line.value)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const grams = packKg(line.item, catalogue, targetLines)
      const item = items.get(line.item.toLowerCase()) ?? { sku: line.item, kg: 0, units: 0 }
      if (line.section.toLowerCase().includes('(units)')) {
        item.units += amount
        item.kg += grams * amount
      } else {
        item.kg += amount
        if (grams > 0) item.units += amount / grams
      }
      items.set(line.item.toLowerCase(), item)
    }
  }
  const list = [...items.values()].sort((a, b) => a.sku.localeCompare(b.sku))
  return list.reduce((sum, line) => ({ kg: sum.kg + line.kg, units: sum.units + line.units, items: list }), { kg: 0, units: 0, items: list })
}

/** SKU-wise target, sales and achievement of one BA at the supervisor's stores (read only). */
export function SupervisorSales({ supervisor }: { supervisor: Supervisor }) {
  const [month, setMonth] = useState(currentMonthKey)
  const [rows, setRows] = useState<TargetRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [baId, setBaId] = useState('')
  const [period, setPeriod] = useState<Period>('month')
  const [catalogue, setCatalogue] = useState<SkuRow[]>([])
  const reports = useDailyReports()

  useEffect(() => { void loadSkuCatalogue().then(setCatalogue) }, [])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    void portalGet<{ results: TargetRow[] }>(`/api/ba-targets/?month=${month}`, 'supervisor').then((data) => {
      if (cancelled) return
      setFailed(!data)
      setRows(data?.results ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [month])

  const people = useMemo(() => {
    const map = new Map<string, { baId: string; baName: string; baCode?: string; storeName?: string }>()
    for (const ba of supervisorOverview(supervisor).bas) map.set(ba.id, { baId: ba.id, baName: ba.name, storeName: ba.store })
    for (const target of rows ?? []) map.set(target.baId, { baId: target.baId, baName: target.baName, baCode: target.baCode, storeName: target.storeName })
    for (const report of reports) {
      if (!report.baId) continue
      if (!map.has(report.baId)) map.set(report.baId, { baId: report.baId, baName: report.baName, baCode: report.baCode, storeName: report.storeName })
    }
    return [...map.values()].sort((a, b) => a.baName.localeCompare(b.baName))
  }, [rows, reports, supervisor])
  const selected = people.find((person) => person.baId === baId) ?? null
  const selectedTarget = rows?.find((row) => row.baId === baId) ?? null
  const sales = useMemo(
    () => summarizeSales(reports, baId, period, catalogue, selectedTarget?.lines ?? []),
    [reports, baId, period, catalogue, selectedTarget?.lines],
  )
  const targetKg = selectedTarget?.targetKg ?? 0
  const targetUnits = (selectedTarget?.lines ?? []).reduce((sum, line) => sum + (line.unit ?? (line.grammage ? Number(line.kg) / line.grammage : 0)), 0)

  const cards = [
    { label: 'Target (kg)', value: num(Math.round(targetKg), 0) },
    { label: 'Target (units)', value: num(Math.round(targetUnits), 0) },
    { label: 'Sales (kg)', value: num(sales.kg) },
    { label: 'Sales (units)', value: num(Math.round(sales.units), 0) },
    { label: 'Achievement', value: `${achievementPct(targetKg, sales.kg)}%` },
  ]

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid min-w-0 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <label className="block min-w-0 text-xs text-slate-500 sm:w-auto">
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) {
                  setMonth(e.target.value)
                  setBaId('')
                }
              }}
              className="mt-1 block w-full max-w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 outline-none focus:border-brand-500 sm:mt-0 sm:ml-2 sm:inline-block sm:w-auto"
            />
          </label>
          <label className="block min-w-0 text-xs text-slate-500 sm:flex-1">
            <span className="mb-1 block">Brand Ambassador</span>
            <select
              value={baId}
              onChange={(e) => setBaId(e.target.value)}
              disabled={rows === null || people.length === 0}
              className="block w-full min-w-0 max-w-full truncate rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            >
              <option value="">Select a BA…</option>
              {people.map((row) => (
                <option key={row.baId} value={row.baId}>
                  {row.baName.length > 38 ? `${row.baName.slice(0, 35)}…` : row.baName}
                  {row.baCode ? ` · ${row.baCode}` : ''}
                </option>
              ))}
            </select>
          </label>
          {rows === null && <span className="text-xs text-slate-400">Loading…</span>}
        </div>
      </Card>

      {selected && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><h3 className="font-semibold text-slate-900">{selected.baName} · Sales & target achievement</h3><p className="mt-0.5 text-xs text-slate-500">Sales for selected period · target for {formatTargetMonth(month)}</p></div>
            <select aria-label="Sales period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-500 sm:w-auto">
              <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last7">Last 7 days</option><option value="month">Current month</option>
            </select>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((card) => <Card key={card.label}><div className="text-xs text-slate-500">{card.label}</div><div className="mt-1 break-words text-xl font-bold text-slate-900">{card.value}</div></Card>)}
          </div>
          {!selectedTarget && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">No target is assigned for this month. Target and achievement are 0%; submitted sales are still shown.</p>}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Sales by SKU · selected period</div>
            {sales.items.length === 0 ? <p className="py-2 text-sm text-slate-500">No SKU sales reported for this period.</p> : <div className="space-y-2">
              {sales.items.map((item) => {
                const line = selectedTarget?.lines?.find((targetLine) => targetLine.sku.toLowerCase() === item.sku.toLowerCase())
                const lineTarget = Number(line?.kg ?? 0)
                return <div key={item.sku} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-slate-50 pb-2 text-xs last:border-0">
                  <span className="min-w-0 break-words font-medium text-slate-700">{item.sku}</span>
                  <span className="text-right tabular-nums"><span className="block font-semibold text-slate-900">{num(item.kg)} kg</span><span className="text-[10px] text-slate-500">target {num(Math.round(lineTarget), 0)} kg · {num(Math.round(line?.unit ?? (line?.grammage ? lineTarget / line.grammage : 0)), 0)} units</span></span>
                  <span className="text-right tabular-nums"><span className="block font-semibold text-slate-900">{num(Math.round(item.units), 0)} units</span><span className="text-[10px] text-brand-600">{achievementPct(lineTarget, item.kg)}%</span></span>
                </div>
              })}
            </div>}
          </div>
        </Card>
      )}

      {failed && <Card><p className="text-sm text-amber-800">Targets could not be loaded. Reported sales are still shown.</p></Card>}
      {!selected && (
        <Card>
          <p className="text-sm text-slate-500">
            {rows !== null && people.length === 0
              ? 'No ambassadors or sales reports are available for your stores.'
              : 'Select a Brand Ambassador to see sales and target achievement.'}
          </p>
        </Card>
      )}
    </div>
  )
}
