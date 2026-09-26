import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { DesktopShell } from '../../components/AppShell'
import { Card, Modal, PageHeader, StatusBadge, TableScroll, Tabs } from '../../components/ui'
import { useComplaints } from '../../context/ComplaintsContext'
import { formatComplaintDate, type Complaint } from '../../data/complaints'
import { useDailyReports } from '../../lib/baReport'
import { signOut, supervisorOverview, useSupervisorSession, type Supervisor } from '../../lib/supervisors'
import {
  SupervisorBaTable,
  SupervisorIncentiveCard,
  SupervisorStoreCards,
  SupervisorSummary,
} from './SupervisorViews'

/** Only a signed-in supervisor (or a Head Office preview of one) gets into the portal. */
export function SupervisorGate() {
  const { supervisor } = useSupervisorSession()
  if (!supervisor) return <Navigate to="/supervisor/login" replace />
  return <DesktopShell kind="supervisor" />
}

function usePortal(title: string, description: string) {
  const { supervisor, preview } = useSupervisorSession()

  const header = (
    <>
      {preview && supervisor && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>
            Head Office preview — you are viewing the portal as <strong>{supervisor.name}</strong>.
          </span>
          <Link
            to="/ho/supervisors"
            onClick={signOut}
            className="text-xs font-semibold text-amber-900 underline"
          >
            Exit preview
          </Link>
        </div>
      )}
      <PageHeader title={title} description={supervisor ? `${supervisor.name} · ${description}` : description} />
    </>
  )

  return { supervisor, header }
}

export function SupervisorHomePage() {
  const { supervisor, header } = usePortal('Supervisor Overview', 'your stores at a glance')
  return (
    <div className="space-y-5">
      {header}
      {supervisor && (
        <>
          <SupervisorSummary supervisor={supervisor} />
          <SupervisorIncentiveCard supervisor={supervisor} />
        </>
      )}
    </div>
  )
}

export function SupervisorStoresPage() {
  const { supervisor, header } = usePortal('Store Characteristics', 'coverage, footfall and peak hours')
  return (
    <div className="space-y-5">
      {header}
      {supervisor ? (
        <SupervisorStoreCards supervisor={supervisor} />
      ) : (
        <Card>
          <p className="text-sm text-slate-500">Sign in to see your stores.</p>
        </Card>
      )}
    </div>
  )
}

export function SupervisorComplaintsPage() {
  const { supervisor, header } = usePortal(
    'Complaints',
    'view only — forms filed by BAs in your stores',
  )
  return (
    <div className="space-y-5">
      {header}
      {supervisor && <SupervisorComplaintList supervisor={supervisor} />}
    </div>
  )
}

function SupervisorComplaintList({ supervisor }: { supervisor: Supervisor }) {
  const { complaints } = useComplaints()
  const [tab, setTab] = useState('All')
  const [selected, setSelected] = useState<Complaint | null>(null)

  const mine = useMemo(
    () => complaints.filter((c) => supervisor.storeIds.includes(c.storeId)),
    [complaints, supervisor.storeIds],
  )

  const filtered = useMemo(() => {
    if (tab === 'All') return mine
    if (tab === 'Customer') return mine.filter((c) => c.kind === 'customer')
    return mine.filter((c) => c.kind === 'ba')
  }, [mine, tab])

  return (
    <>
      <Tabs tabs={['All', 'Customer', 'BA']} value={tab} onChange={setTab} />
      <Card padding={false}>
        <TableScroll minWidth={860}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Store</th>
                <th className="px-4 py-3 font-semibold">BA</th>
                <th className="px-4 py-3 font-semibold">Complaint</th>
                <th className="px-4 py-3 font-semibold">Submitted</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {c.kind === 'customer' ? 'Customer' : 'BA'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{c.storeName}</div>
                    <div className="text-xs text-slate-500">{c.city}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{c.baName}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-slate-700">
                    {c.kind === 'customer' ? `${c.brand} · ${c.sku} — ${c.complaint}` : c.subject}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatComplaintDate(c.createdAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(c)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    No complaints from your stores yet.
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
        title={selected ? `Complaint ${selected.id}` : 'Complaint'}
      >
        {selected && (
          <div className="space-y-3 text-sm text-slate-700">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">View only</p>
            <p>
              <span className="font-semibold text-slate-900">Store: </span>
              {selected.storeName} · {selected.city}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Filed by: </span>
              {selected.baName}
            </p>
            {selected.kind === 'customer' ? (
              <>
                <p>
                  <span className="font-semibold text-slate-900">Brand: </span>
                  {selected.brand}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">SKU: </span>
                  {selected.sku}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Name: </span>
                  {selected.customerName}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Number: </span>
                  {selected.customerNumber}
                </p>
                <p className="whitespace-pre-wrap">
                  <span className="font-semibold text-slate-900">Complaint: </span>
                  {selected.complaint}
                </p>
                {selected.image && (
                  <img
                    src={selected.image}
                    alt="Customer complaint"
                    className="max-h-64 w-full rounded-xl object-contain ring-1 ring-slate-200"
                  />
                )}
              </>
            ) : (
              <>
                <p>
                  <span className="font-semibold text-slate-900">Category: </span>
                  {selected.category}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Subject: </span>
                  {selected.subject}
                </p>
                <p className="whitespace-pre-wrap">
                  <span className="font-semibold text-slate-900">Details: </span>
                  {selected.details}
                </p>
              </>
            )}
            <p>
              <span className="font-semibold text-slate-900">Status: </span>
              {selected.status}
            </p>
          </div>
        )}
      </Modal>
    </>
  )
}

export function SupervisorSubmissionsPage() {
  const { supervisor, header } = usePortal('BA submissions', 'stock, sales and competitor data filed by your BAs')
  const reports = useDailyReports()
  const rows = useMemo(() => {
    if (!supervisor) return []
    const ids = new Set(supervisorOverview(supervisor).bas.map((ba) => ba.id))
    return reports.filter((report) => ids.has(report.baId))
  }, [reports, supervisor])

  return (
    <div className="space-y-5">
      {header}
      <Card padding={false}>
        <TableScroll minWidth={720}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">BA</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Stock lines</th>
                <th className="px-4 py-3">Sales lines</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((report) => (
                <tr key={report.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-xs text-slate-500">{formatComplaintDate(report.submittedAt)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{report.baName}</td>
                  <td className="px-4 py-3 text-slate-600">{report.source}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {Object.values(report.stock).filter((value) => String(value).trim()).length}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {Object.values(report.sales).filter((value) => String(value).trim()).length}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    No BA reports for your stores yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  )
}

export function SupervisorBasPage() {
  const { supervisor, header } = usePortal('BA Performance', 'ambassadors in your stores')
  return (
    <div className="space-y-5">
      {header}
      {supervisor && <SupervisorBaTable supervisor={supervisor} />}
    </div>
  )
}
