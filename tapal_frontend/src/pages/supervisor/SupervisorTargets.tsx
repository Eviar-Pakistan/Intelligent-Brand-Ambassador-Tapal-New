import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card, SearchInput, TableScroll } from '../../components/ui'
import { achievementPct, currentMonthKey, formatTargetMonth, type BaMonthTarget } from '../../lib/baTargets'
import { portalGet } from '../../lib/serverApi'

type TargetRow = BaMonthTarget & { id: number }

const kg = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`

function pctTone(pct: number) {
  if (pct >= 100) return 'text-emerald-600'
  if (pct >= 70) return 'text-amber-600'
  return 'text-rose-600'
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
      <div
        className={pct >= 100 ? 'h-full bg-emerald-500' : pct >= 70 ? 'h-full bg-amber-500' : 'h-full bg-rose-500'}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

/** This month's BA targets and sales achievement at the supervisor's stores (read only; Head Office sets them). */
export function SupervisorTargets() {
  const [month, setMonth] = useState(currentMonthKey)
  const [rows, setRows] = useState<TargetRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (r) => !q || [r.baName, r.baCode, r.storeName, r.storeCode].some((v) => (v ?? '').toLowerCase().includes(q)),
    )
  }, [rows, query])

  const totalTarget = visible.reduce((sum, r) => sum + r.targetKg, 0)
  const totalSales = visible.reduce((sum, r) => sum + r.salesKg, 0)
  const onTrack = visible.filter((r) => achievementPct(r.targetKg, r.salesKg) >= 100).length
  const cards = [
    { label: 'BAs with a target', value: String(visible.length) },
    { label: 'Target', value: kg(totalTarget) },
    { label: 'Sales', value: kg(totalSales) },
    { label: 'Achievement', value: `${achievementPct(totalTarget, totalSales)}%`, hint: `${onTrack} BA(s) at 100%+` },
  ]

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            />
          </label>
          <SearchInput placeholder="Search BA, code or store..." value={query} onChange={(e) => setQuery(e.target.value)} />
          {rows === null && <span className="text-xs text-slate-400">Loading…</span>}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className="text-2xl font-bold text-slate-900">{c.value}</div>
            {c.hint && <div className="text-[11px] text-slate-400">{c.hint}</div>}
          </Card>
        ))}
      </div>

      <Card className="p-0">
        {failed ? (
          <p className="p-5 text-sm text-rose-700">Targets could not be loaded. Check that the server is running.</p>
        ) : rows !== null && visible.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No targets for your stores in {formatTargetMonth(month)}.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3" />
                  <th className="px-4 py-3">BA</th>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3 text-right">Target</th>
                  <th className="px-4 py-3 text-right">Sales</th>
                  <th className="px-4 py-3">Achievement</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const pct = achievementPct(r.targetKg, r.salesKg)
                  const lines = r.lines ?? []
                  const expanded = open === r.id
                  return (
                    <Fragment key={r.id}>
                      <tr
                        className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                        onClick={() => setOpen(expanded ? null : r.id)}
                      >
                        <td className="px-4 py-3 text-slate-400">
                          {lines.length > 0 && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.baName}</div>
                          <div className="font-mono text-xs text-slate-400">{r.baCode}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{r.storeName || '—'}</div>
                          <div className="text-xs text-slate-400">{[r.storeCode, r.city].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{kg(r.targetKg)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{kg(r.salesKg)}</td>
                        <td className="px-4 py-3">
                          <div className={`font-semibold tabular-nums ${pctTone(pct)}`}>{pct}%</div>
                          <Bar pct={pct} />
                        </td>
                      </tr>
                      {expanded && lines.length > 0 && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={5} className="px-4 pb-4">
                            <table className="w-full text-xs">
                              <thead className="text-left text-slate-500">
                                <tr>
                                  <th className="py-2 pr-3">SKU</th>
                                  <th className="py-2 pr-3">Brand</th>
                                  <th className="py-2 pr-3 text-right">Target</th>
                                  <th className="py-2 pr-3 text-right">Sales</th>
                                  <th className="py-2 text-right">Achievement</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line, i) => {
                                  const sales = Number(line.sales ?? 0)
                                  const linePct = achievementPct(Number(line.qty), sales)
                                  return (
                                    <tr key={`${line.sku}-${i}`} className="border-t border-slate-100">
                                      <td className="py-2 pr-3 font-medium">{line.sku}</td>
                                      <td className="py-2 pr-3">{line.brand || '—'}</td>
                                      <td className="py-2 pr-3 text-right tabular-nums">{kg(Number(line.qty))}</td>
                                      <td className="py-2 pr-3 text-right tabular-nums">{kg(sales)}</td>
                                      <td className={`py-2 text-right font-semibold tabular-nums ${pctTone(linePct)}`}>
                                        {linePct}%
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </div>
  )
}
