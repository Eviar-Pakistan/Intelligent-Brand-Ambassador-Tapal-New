import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CheckCircle2, Wallet } from 'lucide-react'
import { Avatar, Button, Card, Modal, StatusBadge, TableScroll } from '../../components/ui'
import { buildSupervisorRoster, formatPkr, type SupervisorIncentive } from '../../lib/incentives'
import { useKpiConfig } from '../../lib/kpiConfig'
import { useCreatedStores } from '../../lib/storeRegistry'
import { useSupervisors } from '../../lib/supervisors'
import { useRoleBase } from './StoreCreation'

type PayoutStatus = 'Pending' | 'Approved' | 'Paid'

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2">
      <span className="text-slate-600">{label}</span>
      <span className="shrink-0 font-semibold text-slate-900">{formatPkr(value)}</span>
    </div>
  )
}

/** Supervisor incentives: base pay plus their stores' team conversion and coverage, from the Set KPIs dialog. */
export function SupervisorIncentives() {
  const base = useRoleBase()
  const config = useKpiConfig()
  const supervisors = useSupervisors()
  const createdStores = useCreatedStores()
  const roster = useMemo(
    () => buildSupervisorRoster(config),
    // recalculated when KPIs, supervisors or the store list change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, supervisors, createdStores],
  )
  const [statusMap, setStatusMap] = useState<Record<string, PayoutStatus>>({})
  const [selected, setSelected] = useState<SupervisorIncentive | null>(null)

  const statusOf = (id: string): PayoutStatus => statusMap[id] ?? 'Pending'
  const setStatus = (id: string, status: PayoutStatus) => setStatusMap((m) => ({ ...m, [id]: status }))
  const sum = (rows: SupervisorIncentive[]) => rows.reduce((s, r) => s + r.totalPkr, 0)

  const totals = {
    pool: sum(roster),
    pending: sum(roster.filter((r) => statusOf(r.supervisorId) === 'Pending')),
    paid: sum(roster.filter((r) => statusOf(r.supervisorId) === 'Paid')),
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Wallet size={14} /> Supervisor incentive pool
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{formatPkr(totals.pool)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Pending approval</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{formatPkr(totals.pending)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Paid out</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{formatPkr(totals.paid)}</div>
        </Card>
      </div>

      <Card padding={false}>
        <TableScroll minWidth={980}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Supervisor</th>
                <th className="px-4 py-3">Stores</th>
                <th className="px-4 py-3">Team conversion</th>
                <th className="px-4 py-3">Coverage</th>
                <th className="px-4 py-3">Base pay</th>
                <th className="px-4 py-3">Incentive</th>
                <th className="px-4 py-3">Total (PKR)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => {
                const st = statusOf(r.supervisorId)
                return (
                  <tr key={r.supervisorId} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={r.name} size="sm" />
                        <div>
                          <Link to={`${base}/supervisors/${r.supervisorId}`} className="font-medium hover:text-brand-600">
                            {r.name}
                          </Link>
                          <div className="text-xs text-slate-400">{r.city}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.storeCount} <span className="text-xs text-slate-400">· {r.baCount} BAs</span>
                    </td>
                    <td className="px-4 py-3">{r.teamConversion}%</td>
                    <td className="px-4 py-3">{r.coverage}%</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{formatPkr(r.base)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{formatPkr(r.incentive)}</td>
                    <td className="px-4 py-3">
                      <button className="font-bold text-slate-900 hover:text-brand-600" onClick={() => setSelected(r)}>
                        {formatPkr(r.totalPkr)}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={st === 'Paid' ? 'Active' : st === 'Approved' ? 'Certified' : 'Pending'} />
                      <span className="ml-1 text-[11px] text-slate-500">{st}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setSelected(r)}>
                          Breakdown
                        </Button>
                        {st === 'Pending' && (
                          <Button size="sm" onClick={() => setStatus(r.supervisorId, 'Approved')}>
                            Approve
                          </Button>
                        )}
                        {st === 'Approved' && (
                          <Button size="sm" variant="success" onClick={() => setStatus(r.supervisorId, 'Paid')}>
                            <Banknote size={13} /> Mark paid
                          </Button>
                        )}
                        {st === 'Paid' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 size={13} /> Paid
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {roster.length === 0 && (
                <tr className="border-t border-slate-100">
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">
                    No supervisors yet — add one under Supervisors.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Incentive · ${selected.name}` : 'Incentive'}
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-navy-900 px-4 py-3 text-white">
              <div className="text-xs text-emerald-200">Total this week</div>
              <div className="text-2xl font-black">{formatPkr(selected.totalPkr)}</div>
              <div className="text-xs text-slate-300">
                {selected.storeCount} stores · {selected.baCount} BAs
              </div>
            </div>
            <Row label="Base pay" value={selected.base} />
            <Row
              label={`Team conversion (${selected.teamConversion}% of ${config.supConversionTarget}% → ${formatPkr(config.supConversionAmount)})`}
              value={selected.conversionPay}
            />
            <Row
              label={`Store coverage (${selected.coverage}% of ${config.supCoverageTarget}% → ${formatPkr(config.supCoverageAmount)})`}
              value={selected.coveragePay}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Close
              </Button>
              {statusOf(selected.supervisorId) === 'Pending' && (
                <Button
                  onClick={() => {
                    setStatus(selected.supervisorId, 'Approved')
                    setSelected(null)
                  }}
                >
                  Approve
                </Button>
              )}
              {statusOf(selected.supervisorId) === 'Approved' && (
                <Button
                  variant="success"
                  onClick={() => {
                    setStatus(selected.supervisorId, 'Paid')
                    setSelected(null)
                  }}
                >
                  Mark paid
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
