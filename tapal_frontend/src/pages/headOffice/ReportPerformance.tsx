import { useMemo, type ReactNode } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { Card, StatusBadge, TableScroll } from '../../components/ui'
import { baRanking, stores } from '../../data/mock'
import { attendanceForRange, daysInRange } from '../../data/baAttendance'
import {
  MONTH_ORDER,
  baPerformanceRecords,
} from '../../data/baPerformance'
import '../../lib/chartjs'
import { chartGold, chartGreen, chartGrid, chartTick } from '../../lib/chartjs'
import { achievementPct, currentMonthKey, formatTargetMonth, useBaTargets } from '../../lib/baTargets'
import { buildIncentiveRoster, formatPkr } from '../../lib/incentives'
import { useCreatedStores } from '../../lib/storeRegistry'

const axis = {
  grid: { color: chartGrid },
  ticks: { color: chartTick, font: { size: 11 } },
  border: { display: false },
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { boxWidth: 12, font: { size: 11 }, color: '#64748b' },
    },
  },
}

function ReportBlock({
  n,
  title,
  hint,
  children,
}: {
  n: string
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <Card>
      <div className="mb-1 text-xs font-bold tracking-wide text-brand-600 uppercase">
        {n} — {title}
      </div>
      <p className="mb-4 text-sm text-slate-500">{hint}</p>
      {children}
    </Card>
  )
}

function achievementClass(pct: number) {
  if (pct >= 100) return 'font-semibold text-emerald-700'
  if (pct >= 80) return 'font-semibold text-amber-700'
  return 'font-semibold text-rose-700'
}

export function ReportPerformance() {
  const createdStores = useCreatedStores()
  const targets = useBaTargets()
  const monthKey = currentMonthKey()

  const storeRows = useMemo(
    () => [...stores].sort((a, b) => b.conversion - a.conversion),
    [createdStores],
  )

  const baRows = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const elapsed = daysInRange({ start, end })
    const present = new Map<string, { days: Set<string>; hours: number[] }>()
    for (const record of attendanceForRange({ start, end }, now)) {
      const row = present.get(record.ba) ?? { days: new Set<string>(), hours: [] }
      row.days.add(record.date.toDateString())
      row.hours.push(record.hours)
      present.set(record.ba, row)
    }
    return buildIncentiveRoster().map((pay) => {
      const attendance = present.get(pay.name)
      const days = attendance?.days.size ?? 0
      const hours = attendance?.hours.length
        ? attendance.hours.reduce((sum, value) => sum + value, 0) / attendance.hours.length
        : 0
      const rank = baRanking.find((ba) => ba.id === pay.baId)
      return {
        ...pay,
        points: rank?.points ?? 0,
        days,
        hours: Math.round(hours * 10) / 10,
        attendancePct: elapsed > 0 ? Math.round((days / elapsed) * 100) : 0,
        elapsed,
      }
    })
  }, [])

  const ambassadorRows = useMemo(() => {
    return targets
      .filter((row) => row.month === monthKey)
      .map((row) => ({
        ...row,
        achievement: achievementPct(row.targetKg, row.salesKg),
      }))
      .sort((a, b) => b.achievement - a.achievement)
  }, [monthKey, targets])

  const monthSeries = useMemo(() => {
    const totals = new Map<string, { target: number; sales: number }>()
    for (const record of baPerformanceRecords) {
      const row = totals.get(record.month) ?? { target: 0, sales: 0 }
      row.target += record.targetKg
      row.sales += record.salesKg
      totals.set(record.month, row)
    }
    return MONTH_ORDER.filter((month) => totals.has(month)).map((month) => {
      const row = totals.get(month)!
      return { month, target: Math.round(row.target), sales: Math.round(row.sales) }
    })
  }, [])

  const programme = monthSeries.reduce(
    (sum, row) => ({ target: sum.target + row.target, sales: sum.sales + row.sales }),
    { target: 0, sales: 0 },
  )
  const ambassadorTarget = ambassadorRows.reduce((sum, row) => sum + row.targetKg, 0)
  const ambassadorSales = ambassadorRows.reduce((sum, row) => sum + row.salesKg, 0)
  const elapsedDays = baRows[0]?.elapsed ?? 0

  return (
    <>
      <ReportBlock
        n="02"
        title="Store performance"
        hint="Engagement, conversion and coverage for each store."
      >
        <div className="relative h-64 w-full">
          <Bar
            data={{
              labels: storeRows.map((store) => store.name),
              datasets: [
                { label: 'Engagement %', data: storeRows.map((store) => store.engagement), backgroundColor: chartGreen },
                { label: 'Conversion %', data: storeRows.map((store) => store.conversion), backgroundColor: chartGold },
                { label: 'Coverage %', data: storeRows.map((store) => store.coverage), backgroundColor: '#64748b' },
              ],
            }}
            options={{ ...chartOptions, scales: { x: axis, y: { ...axis, beginAtZero: true, max: 100 } } }}
          />
        </div>
        <TableScroll minWidth={720} className="mt-4">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2">Today’s footfall</th>
                <th className="px-3 py-2">Engagement</th>
                <th className="px-3 py-2">Conversion</th>
                <th className="px-3 py-2">Coverage</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {storeRows.map((store) => (
                <tr key={store.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{store.name}</td>
                  <td className="px-3 py-2 text-slate-600">{store.city}</td>
                  <td className="px-3 py-2 tabular-nums">{store.todayFootfall.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums">{store.engagement}%</td>
                  <td className="px-3 py-2 tabular-nums">{store.conversion}%</td>
                  <td className="px-3 py-2 tabular-nums">{store.coverage}%</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={store.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </ReportBlock>

      <ReportBlock
        n="03"
        title="BA performance · attendance vs incentive"
        hint={`Month to date · ${elapsedDays} day${elapsedDays === 1 ? '' : 's'}. Days present sit against the incentive earned from conversion and sessions.`}
      >
        <div className="relative h-64 w-full">
          <Bar
            data={{
              labels: baRows.map((row) => row.name),
              datasets: [
                {
                  label: 'Days present',
                  data: baRows.map((row) => row.days),
                  backgroundColor: chartGreen,
                  yAxisID: 'y',
                },
                {
                  label: 'Incentive (PKR)',
                  data: baRows.map((row) => row.incentive),
                  backgroundColor: chartGold,
                  yAxisID: 'y1',
                },
              ],
            }}
            options={{
              ...chartOptions,
              scales: {
                x: axis,
                y: { ...axis, beginAtZero: true, position: 'left', title: { display: true, text: 'Days', color: chartTick } },
                y1: {
                  ...axis,
                  beginAtZero: true,
                  position: 'right',
                  grid: { drawOnChartArea: false },
                  title: { display: true, text: 'PKR', color: chartTick },
                },
              },
            }}
          />
        </div>
        <TableScroll minWidth={760} className="mt-4">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Ambassador</th>
                <th className="px-3 py-2">Points</th>
                <th className="px-3 py-2">Conversion</th>
                <th className="px-3 py-2">Days present</th>
                <th className="px-3 py-2">Attendance</th>
                <th className="px-3 py-2">Avg hours</th>
                <th className="px-3 py-2">Incentive</th>
              </tr>
            </thead>
            <tbody>
              {baRows.map((row) => (
                <tr key={row.baId} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{row.name}</td>
                  <td className="px-3 py-2 tabular-nums">{row.points.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums">{row.conversion}%</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.days}/{row.elapsed}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${achievementClass(row.attendancePct)}`}>{row.attendancePct}%</td>
                  <td className="px-3 py-2 tabular-nums">{row.hours}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-700">{formatPkr(row.incentive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </ReportBlock>

      <ReportBlock
        n="04"
        title="Overall target vs achievement"
        hint={`${formatTargetMonth(monthKey)} ambassador targets, then campaign sales by month.`}
      >
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Mini label="Target (Kg)" value={ambassadorTarget.toLocaleString()} />
          <Mini label="Sales (Kg)" value={ambassadorSales.toLocaleString()} />
          <Mini
            label="Achievement"
            value={`${achievementPct(ambassadorTarget, ambassadorSales)}%`}
          />
        </div>
        {ambassadorRows.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No ambassador targets for {formatTargetMonth(monthKey)}.
          </p>
        ) : (
          <>
            <div className="relative h-64 w-full">
              <Bar
                data={{
                  labels: ambassadorRows.map((row) => row.baName),
                  datasets: [
                    { label: 'Target (Kg)', data: ambassadorRows.map((row) => row.targetKg), backgroundColor: chartGold },
                    { label: 'Sales (Kg)', data: ambassadorRows.map((row) => row.salesKg), backgroundColor: chartGreen },
                  ],
                }}
                options={{ ...chartOptions, scales: { x: axis, y: { ...axis, beginAtZero: true } } }}
              />
            </div>
            <TableScroll minWidth={560} className="mt-4">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Ambassador</th>
                    <th className="px-3 py-2">Target (Kg)</th>
                    <th className="px-3 py-2">Sales (Kg)</th>
                    <th className="px-3 py-2">Achievement</th>
                  </tr>
                </thead>
                <tbody>
                  {ambassadorRows.map((row) => (
                    <tr key={row.baId} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">{row.baName}</td>
                      <td className="px-3 py-2 tabular-nums">{row.targetKg.toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums">{row.salesKg.toLocaleString()}</td>
                      <td className={`px-3 py-2 tabular-nums ${achievementClass(row.achievement)}`}>{row.achievement}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </>
        )}

        <h3 className="mt-6 text-sm font-semibold text-slate-900">Campaign months</h3>
        <p className="mb-3 text-xs text-slate-500">
          {programme.sales.toLocaleString()} Kg sold against {programme.target.toLocaleString()} Kg target ·{' '}
          {achievementPct(programme.target, programme.sales)}% overall
        </p>
        <div className="relative h-64 w-full">
          <Line
            data={{
              labels: monthSeries.map((row) => row.month.slice(0, 3)),
              datasets: [
                {
                  label: 'Target (Kg)',
                  data: monthSeries.map((row) => row.target),
                  borderColor: chartGold,
                  backgroundColor: chartGold,
                  borderDash: [5, 4],
                  tension: 0.25,
                  pointRadius: 3,
                },
                {
                  label: 'Sales (Kg)',
                  data: monthSeries.map((row) => row.sales),
                  borderColor: chartGreen,
                  backgroundColor: chartGreen,
                  tension: 0.25,
                  pointRadius: 3,
                },
              ],
            }}
            options={{ ...chartOptions, scales: { x: axis, y: { ...axis, beginAtZero: true } } }}
          />
        </div>
      </ReportBlock>
    </>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}
