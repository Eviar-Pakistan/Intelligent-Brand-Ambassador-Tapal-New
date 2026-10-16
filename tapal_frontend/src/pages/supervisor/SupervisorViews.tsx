import { Avatar, Card, CardHeader, KpiCard, ListPager, StatusBadge, TableScroll, usePagedList } from '../../components/ui'
import { calculateSupervisorIncentive, formatPkr } from '../../lib/incentives'
import { useKpiConfig } from '../../lib/kpiConfig'
import { findCreatedStore, useCreatedStores } from '../../lib/storeRegistry'
import { supervisorOverview, type Supervisor, type SupervisorBa } from '../../lib/supervisors'
import { baInterceptionStats, useUserInterceptions } from '../../lib/userInterceptions'

/** The sections of a supervisor's view. Used in their own portal and on Head Office's supervisor page. */

export function supervisorCallTotals(bas: SupervisorBa[], interceptions: ReturnType<typeof useUserInterceptions>) {
  const unique = [...new Map(bas.map((ba) => [ba.id, withCallCounts(ba, interceptions)])).values()]
  const fromServer = unique.length > 0 && unique.every((ba) => typeof ba.totalInterceptions === 'number' && typeof ba.convertedCalls === 'number')
  if (fromServer) {
    const totalInterceptions = unique.reduce((sum, ba) => sum + (ba.totalInterceptions ?? 0), 0)
    const productiveCalls = unique.reduce((sum, ba) => sum + (ba.productiveCalls ?? 0), 0)
    const nonProductiveCalls = unique.reduce((sum, ba) => sum + (ba.nonProductiveCalls ?? 0), 0)
    const converted = unique.reduce((sum, ba) => sum + (ba.convertedCalls ?? 0), 0)
    return {
      totalInterceptions,
      productiveCalls,
      nonProductiveCalls,
      conversion: totalInterceptions ? Math.round((converted / totalInterceptions) * 1000) / 10 : 0,
    }
  }
  const ids = new Set(unique.map((ba) => ba.id))
  return baInterceptionStats(interceptions.filter((row) => ids.has(row.baId)))
}

export function SupervisorSummary({ supervisor }: { supervisor: Supervisor }) {
  useCreatedStores()
  const interceptions = useUserInterceptions()
  const o = supervisorOverview(supervisor)
  const calls = supervisorCallTotals(o.bas, interceptions)
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      <KpiCard label="Stores" value={o.stores.length} />
      <KpiCard label="Ambassadors" value={new Set(o.bas.map((b) => b.id)).size} />
      <KpiCard label="Total interceptions" value={calls.totalInterceptions.toLocaleString()} hint="All of their BAs" />
      <KpiCard label="Productive calls" value={calls.productiveCalls.toLocaleString()} />
      <KpiCard label="Non-productive" value={calls.nonProductiveCalls.toLocaleString()} />
      <KpiCard label="Team conversion" value={`${calls.conversion}%`} hint="Productive, previous brand not Tapal, divided by all their interceptions" />
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
              <div className="min-w-0">
                <div className="break-words font-semibold text-slate-900">
                  #{s.id} {s.name}
                </div>
                <div className="text-xs text-slate-500">{s.city}</div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <StatusBadge status={s.status} />
                <StatusBadge status={s.footfall} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <Stat label="Engagement" value={`${s.engagement}%`} />
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

function withCallCounts(ba: SupervisorBa, interceptions: ReturnType<typeof useUserInterceptions>): SupervisorBa {
  if (typeof ba.totalInterceptions === 'number') return ba
  const stats = baInterceptionStats(interceptions.filter((row) => row.baId === ba.id))
  return { ...ba, ...stats }
}

export function SupervisorBaTable({ supervisor }: { supervisor: Supervisor }) {
  useCreatedStores()
  const interceptions = useUserInterceptions()
  const { bas } = supervisorOverview(supervisor)
  const sorted = bas.map((ba) => withCallCounts(ba, interceptions)).sort((a, b) => b.conversion - a.conversion)
  const page = usePagedList(sorted, sorted.map((ba) => ba.id).join())

  return (
    <Card padding={false}>
      <div className="border-b border-slate-50 px-4 py-3 sm:px-5">
        <CardHeader title="BA performance" subtitle="Ambassadors working in your stores" />
      </div>
      <ul className="divide-y divide-slate-100 sm:hidden">
        {page.rows.map((b) => (
          <li key={`${b.id}-${b.storeId}`} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={b.name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{b.name}</div>
                  <div className="truncate text-xs text-slate-500">{b.store}</div>
                </div>
              </div>
              <StatusBadge status={b.state} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center">
              <Stat label="Total interceptions" value={String(b.totalInterceptions ?? 0)} />
              <Stat label="Productive calls" value={String(b.productiveCalls ?? 0)} />
              <Stat label="Non-productive" value={String(b.nonProductiveCalls ?? 0)} />
              <Stat label="Conversion" value={`${b.conversion}%`} />
            </div>
          </li>
        ))}
        {sorted.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-400">No ambassadors are assigned to these stores yet.</li>
        )}
      </ul>
      <TableScroll minWidth={960} className="hidden sm:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">BA</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total interceptions</th>
              <th className="px-4 py-3">Productive calls</th>
              <th className="px-4 py-3">Non-productive</th>
              <th className="px-4 py-3">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((b) => (
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
                <td className="px-4 py-3 tabular-nums">{b.totalInterceptions ?? 0}</td>
                <td className="px-4 py-3 tabular-nums">{b.productiveCalls ?? 0}</td>
                <td className="px-4 py-3 tabular-nums">{b.nonProductiveCalls ?? 0}</td>
                <td className="px-4 py-3 font-semibold">{b.conversion}%</td>
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
      <ListPager
        page={page.page}
        pageCount={page.pageCount}
        from={page.from}
        to={page.to}
        total={page.total}
        onPage={page.setPage}
      />
    </Card>
  )
}

export function SupervisorIncentiveCard({ supervisor }: { supervisor: Supervisor }) {
  const config = useKpiConfig()
  useCreatedStores()
  const interceptions = useUserInterceptions()
  const pay = calculateSupervisorIncentive(supervisor, config)
  const conversion = supervisorCallTotals(supervisorOverview(supervisor).bas, interceptions).conversion
  const conversionPay = config.supConversionTarget
    ? Math.round((conversion / config.supConversionTarget) * config.supConversionAmount)
    : 0
  const total = pay.base + conversionPay

  return (
    <Card>
      <CardHeader title="Supervisor incentive" subtitle="This week · calculated from the KPIs set by Head Office" />
      <div className="rounded-xl bg-navy-900 px-4 py-3 text-white">
        <div className="text-xs text-emerald-200">Total this week</div>
        <div className="text-2xl font-black">{formatPkr(total)}</div>
      </div>
      <div className="mt-3 text-sm">
        <PayRow label="Base pay" value={formatPkr(pay.base)} />
        <PayRow
          label={`Team conversion (${conversion}% of ${config.supConversionTarget}% → ${formatPkr(config.supConversionAmount)})`}
          value={formatPkr(conversionPay)}
        />
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2 py-2.5">
      <div className="truncate text-[11px] text-slate-500">{label}</div>
      <div className="truncate text-base font-bold text-slate-900">{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-800">{value || '—'}</dd>
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
