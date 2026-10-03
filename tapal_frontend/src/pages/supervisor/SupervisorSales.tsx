import { useEffect, useMemo, useState } from 'react'
import { Card, TableScroll } from '../../components/ui'
import { achievementPct, currentMonthKey, formatTargetMonth, type BaMonthTarget, type TargetLine } from '../../lib/baTargets'
import { portalGet } from '../../lib/serverApi'

type TargetRow = BaMonthTarget & { id: number }

const num = (value: number, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits })

function pctTone(pct: number) {
  if (pct >= 100) return 'text-emerald-600'
  if (pct >= 70) return 'text-amber-600'
  return 'text-rose-600'
}

/** One SKU's target and sales in kg and in whole units (kg / grammage). */
function skuFigures(line: TargetLine) {
  const grammage = line.grammage && line.grammage > 0 ? line.grammage : 0
  const targetKg = Number(line.kg) || 0
  const salesKg = Number(line.sales ?? 0)
  return {
    targetKg,
    targetUnits: Math.round(line.unit ?? (grammage ? targetKg / grammage : 0)),
    salesKg,
    salesUnits: grammage ? Math.round(salesKg / grammage) : 0,
  }
}

/** SKU-wise target, sales and achievement of one BA at the supervisor's stores (read only). */
export function SupervisorSales() {
  const [month, setMonth] = useState(currentMonthKey)
  const [rows, setRows] = useState<TargetRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [baId, setBaId] = useState('')

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

  const people = useMemo(
    () => [...(rows ?? [])].sort((a, b) => a.baName.localeCompare(b.baName)),
    [rows],
  )
  const selected = people.find((row) => row.baId === baId) ?? null

  const lines = useMemo(
    () =>
      (selected?.lines ?? [])
        .filter((line) => Number(line.kg) > 0)
        .map((line) => ({ line, ...skuFigures(line) })),
    [selected],
  )
  const total = lines.reduce(
    (sum, row) => ({
      targetKg: sum.targetKg + row.targetKg,
      targetUnits: sum.targetUnits + row.targetUnits,
      salesKg: sum.salesKg + row.salesKg,
      salesUnits: sum.salesUnits + row.salesUnits,
    }),
    { targetKg: 0, targetUnits: 0, salesKg: 0, salesUnits: 0 },
  )
  const totalPct = achievementPct(total.targetKg, total.salesKg)

  const cards = [
    { label: 'Target (kg)', value: num(total.targetKg) },
    { label: 'Target (units)', value: num(total.targetUnits, 0) },
    { label: 'Sales (kg)', value: num(total.salesKg) },
    { label: 'Sales (units)', value: num(total.salesUnits, 0) },
    { label: 'Achievement (kg)', value: `${totalPct}%` },
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
              onChange={(e) => {
                if (e.target.value) {
                  setMonth(e.target.value)
                  setBaId('')
                }
              }}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            />
          </label>
          <label className="text-xs text-slate-500">
            Brand Ambassador
            <select
              value={baId}
              onChange={(e) => setBaId(e.target.value)}
              disabled={people.length === 0}
              className="ml-2 min-w-56 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            >
              <option value="">Select a BA…</option>
              {people.map((row) => (
                <option key={row.baId} value={row.baId}>
                  {row.baName}
                  {row.baCode ? ` (${row.baCode})` : ''}
                  {row.storeName ? ` · ${row.storeName}` : ''}
                </option>
              ))}
            </select>
          </label>
          {rows === null && <span className="text-xs text-slate-400">Loading…</span>}
        </div>
      </Card>

      {failed ? (
        <Card>
          <p className="text-sm text-rose-700">Sales could not be loaded. Check that the server is running.</p>
        </Card>
      ) : rows !== null && people.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No targets for your stores in {formatTargetMonth(month)}.</p>
        </Card>
      ) : !selected ? (
        <Card>
          <p className="text-sm text-slate-500">Select a Brand Ambassador to see SKU-wise target and sales.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            {cards.map((c) => (
              <Card key={c.label}>
                <div className="text-xs text-slate-500">{c.label}</div>
                <div className="text-2xl font-bold text-slate-900">{c.value}</div>
              </Card>
            ))}
          </div>

          <Card className="p-0">
            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
              <div className="text-sm font-semibold text-slate-900">
                {selected.baName}
                {selected.baCode && <span className="ml-2 text-xs font-normal text-slate-400">{selected.baCode}</span>}
              </div>
              <div className="text-xs text-slate-500">
                {[selected.storeName, selected.city, formatTargetMonth(month)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <TableScroll minWidth={760}>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Brand</th>
                    <th className="px-4 py-3 text-right">Target (kg)</th>
                    <th className="px-4 py-3 text-right">Target (units)</th>
                    <th className="px-4 py-3 text-right">Sales (kg)</th>
                    <th className="px-4 py-3 text-right">Sales (units)</th>
                    <th className="px-4 py-3 text-right">Achievement</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(({ line, targetKg, targetUnits, salesKg, salesUnits }) => {
                    const pct = achievementPct(targetKg, salesKg)
                    return (
                      <tr key={line.sku} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-900">{line.sku}</td>
                        <td className="px-4 py-3 text-slate-600">{line.brand || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{num(targetKg)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{num(targetUnits, 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{num(salesKg)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{num(salesUnits, 0)}</td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${pctTone(pct)}`}>{pct}%</td>
                      </tr>
                    )
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                        No SKU targets saved for this BA in {formatTargetMonth(month)}.
                      </td>
                    </tr>
                  )}
                  {lines.length > 0 && (
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(total.targetKg)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(total.targetUnits, 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(total.salesKg)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(total.salesUnits, 0)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${pctTone(totalPct)}`}>{totalPct}%</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </>
      )}
    </div>
  )
}
