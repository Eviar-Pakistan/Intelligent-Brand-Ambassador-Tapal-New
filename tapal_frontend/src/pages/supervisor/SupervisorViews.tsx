import { Avatar, Card, CardHeader, KpiCard, ProgressBar, StatusBadge, TableScroll } from '../../components/ui'
import { calculateSupervisorIncentive, formatPkr } from '../../lib/incentives'
import { useKpiConfig } from '../../lib/kpiConfig'
import { findCreatedStore, useCreatedStores } from '../../lib/storeRegistry'
import { supervisorOverview, type Supervisor } from '../../lib/supervisors'

/** The sections of a supervisor's view. Used in their own portal and on Head Office's supervisor page. */

export function SupervisorSummary({ supervisor }: { supervisor: Supervisor }) {
  useCreatedStores()
  const o = supervisorOverview(supervisor)
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <KpiCard label="Stores" value={o.stores.length} />
      <KpiCard label="Ambassadors" value={new Set(o.bas.map((b) => b.id)).size} />
      <KpiCard label="Team conversion" value={`${o.teamConversion}%`} hint="Average of their BAs" />
      <KpiCard label="Store coverage" value={`${o.coverage}%`} hint="Average of their stores" />
      <KpiCard label="Today's footfall" value={o.todayFootfall.toLocaleString()} />
    </div>
  )
}

export function SupervisorStoreCards({ supervisor }: { supervisor: Supervisor }) {
  useCreatedStores()
  const { stores } = supervisorOverview(supervisor)

  if (stores.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500">No stores are assigned to this supervisor yet.</p>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {stores.map((s) => {
        const details = findCreatedStore(s.id)
        return (
          <Card key={s.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">
                  #{s.id} {s.name}
                </div>
                <div className="text-xs text-slate-500">{s.city}</div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <StatusBadge status={s.status} />
                <StatusBadge status={s.footfall} />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>BA coverage</span>
                <span className="font-semibold text-slate-800">{s.coverage}%</span>
              </div>
              <ProgressBar value={s.coverage} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat label="Engagement" value={`${s.engagement}%`} />
              <Stat label="Conversion" value={`${s.conversion}%`} />
              <Stat label="Footfall today" value={s.todayFootfall.toLocaleString()} />
            </div>

            <dl className="mt-4 space-y-1.5 text-xs">
              <Row label="Peak hours" value={s.peak.join(' · ')} />
              <Row label="Ambassadors" value={s.assigned.length ? s.assigned.map((a) => a.name).join(', ') : 'None assigned'} />
              {details && (
                <>
                  <Row label="Address" value={details.address} />
                  <Row label="Contact" value={[details.contactPerson, details.contactPhone].filter(Boolean).join(' · ')} />
                </>
              )}
            </dl>
          </Card>
        )
      })}
    </div>
  )
}

export function SupervisorBaTable({ supervisor }: { supervisor: Supervisor }) {
  useCreatedStores()
  const { bas } = supervisorOverview(supervisor)
  const sorted = [...bas].sort((a, b) => b.conversion - a.conversion)

  return (
    <Card padding={false}>
      <div className="border-b border-slate-50 px-4 py-3 sm:px-5">
        <CardHeader title="BA performance" subtitle="Ambassadors working in your stores" />
      </div>
      <TableScroll minWidth={640}>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">BA</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Conversion</th>
              <th className="px-4 py-3">Sessions</th>
              <th className="px-4 py-3">Points</th>
              <th className="px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => (
              <tr key={`${b.id}-${b.storeId}`} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={b.name} size="sm" />
                    <span className="font-medium text-slate-900">{b.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{b.store}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={b.state} />
                </td>
                <td className="px-4 py-3 font-semibold">{b.conversion}%</td>
                <td className="px-4 py-3 tabular-nums">{b.sessions}</td>
                <td className="px-4 py-3 tabular-nums">{b.points.toLocaleString()}</td>
                <td className="px-4 py-3 tabular-nums">{b.score ? `${b.score}%` : '—'}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr className="border-t border-slate-100">
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                  No ambassadors are assigned to these stores yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  )
}

export function SupervisorIncentiveCard({ supervisor }: { supervisor: Supervisor }) {
  const config = useKpiConfig()
  useCreatedStores()
  const pay = calculateSupervisorIncentive(supervisor, config)

  return (
    <Card>
      <CardHeader title="Supervisor incentive" subtitle="This week · calculated from the KPIs set by Head Office" />
      <div className="rounded-xl bg-navy-900 px-4 py-3 text-white">
        <div className="text-xs text-emerald-200">Total this week</div>
        <div className="text-2xl font-black">{formatPkr(pay.totalPkr)}</div>
      </div>
      <div className="mt-3 text-sm">
        <PayRow label="Base pay" value={formatPkr(pay.base)} />
        <PayRow
          label={`Team conversion (${pay.teamConversion}% of ${config.supConversionTarget}% → ${formatPkr(config.supConversionAmount)})`}
          value={formatPkr(pay.conversionPay)}
        />
        <PayRow
          label={`Store coverage (${pay.coverage}% of ${config.supCoverageTarget}% → ${formatPkr(config.supCoverageAmount)})`}
          value={formatPkr(pay.coveragePay)}
        />
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-base font-bold text-slate-900">{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 font-medium text-slate-800">{value || '—'}</dd>
    </div>
  )
}

function PayRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="shrink-0 font-semibold text-slate-900">{value}</span>
    </div>
  )
}
