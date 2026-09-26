import { useMemo, useState } from 'react'
import { MessageSquareWarning, CheckCircle2, Clock3, Eye, UserRound } from 'lucide-react'
import {
  Button,
  Card,
  Modal,
  PageHeader,
  StatusBadge,
  TableScroll,
  Tabs,
} from '../../components/ui'
import { useComplaints } from '../../context/ComplaintsContext'
import {
  formatComplaintDate,
  type Complaint,
  type ComplaintKind,
  type ComplaintStatus,
} from '../../data/complaints'

const TYPE_TABS = ['All', 'Customer Complaint', 'BA Complaint'] as const

function kindFromTab(tab: string): ComplaintKind | 'all' {
  if (tab === 'Customer Complaint') return 'customer'
  if (tab === 'BA Complaint') return 'ba'
  return 'all'
}

function typeLabel(kind: ComplaintKind) {
  return kind === 'customer' ? 'Customer' : 'BA'
}

export function ComplaintsPage() {
  const { complaints, updateComplaintStatus } = useComplaints()
  const [typeTab, setTypeTab] = useState<(typeof TYPE_TABS)[number]>('All')
  const [tab, setTab] = useState('All')
  const [selected, setSelected] = useState<Complaint | null>(null)
  const [note, setNote] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const kind = kindFromTab(typeTab)

  const byType = useMemo(() => {
    if (kind === 'all') return complaints
    return complaints.filter((c) => c.kind === kind)
  }, [complaints, kind])

  const filtered = useMemo(() => {
    if (tab === 'All') return byType
    return byType.filter((c) => c.status === tab)
  }, [byType, tab])

  const counts = useMemo(
    () => ({
      customer: complaints.filter((c) => c.kind === 'customer').length,
      ba: complaints.filter((c) => c.kind === 'ba').length,
      open: byType.filter((c) => c.status === 'Open').length,
      review: byType.filter((c) => c.status === 'In Review').length,
      resolved: byType.filter((c) => c.status === 'Resolved').length,
    }),
    [complaints, byType],
  )

  function openDetail(c: Complaint) {
    setSelected(c)
    setNote(c.hoNote ?? '')
  }

  function setStatus(status: ComplaintStatus) {
    if (!selected) return
    updateComplaintStatus(selected.id, status, note.trim() || undefined)
    setToast(`Complaint ${selected.id} marked ${status}`)
    setSelected(null)
    setTimeout(() => setToast(null), 2800)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Complaint Center"
        description="Review customer product complaints and Brand Ambassador store complaints"
      />

      {toast && (
        <div className="animate-fade-up rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <UserRound size={14} /> Customer
          </div>
          <div className="mt-1 text-2xl font-bold text-navy-900">{counts.customer}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <MessageSquareWarning size={14} /> BA
          </div>
          <div className="mt-1 text-2xl font-bold text-navy-900">{counts.ba}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <MessageSquareWarning size={14} /> Open
          </div>
          <div className="mt-1 text-2xl font-bold text-rose-600">{counts.open}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Eye size={14} /> In review
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{counts.review}</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <CheckCircle2 size={14} /> Resolved
          </div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{counts.resolved}</div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={[...TYPE_TABS]} value={typeTab} onChange={(v) => setTypeTab(v as (typeof TYPE_TABS)[number])} />
        <Tabs tabs={['All', 'Open', 'In Review', 'Resolved', 'Rejected']} value={tab} onChange={setTab} />
      </div>

      <Card padding={false}>
        <TableScroll minWidth={kind === 'customer' ? 980 : 860}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              {kind === 'customer' ? (
                <tr>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Number</th>
                  <th className="px-4 py-3 font-semibold">Brand</th>
                  <th className="px-4 py-3 font-semibold">SKU</th>
                  <th className="px-4 py-3 font-semibold">Complaint</th>
                  <th className="px-4 py-3 font-semibold">Image</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              ) : kind === 'ba' ? (
                <tr>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">BA</th>
                  <th className="px-4 py-3 font-semibold">Store</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Subject</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              ) : (
                <tr>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Reported by</th>
                  <th className="px-4 py-3 font-semibold">Detail</th>
                  <th className="px-4 py-3 font-semibold">Complaint</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.id}</td>
                  {c.kind === 'customer' && kind === 'customer' ? (
                    <>
                      <td className="px-4 py-3 font-medium text-slate-900">{c.customerName}</td>
                      <td className="px-4 py-3 text-slate-700">{c.customerNumber}</td>
                      <td className="px-4 py-3 text-slate-700">{c.brand}</td>
                      <td className="px-4 py-3 text-slate-700">{c.sku}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-700">{c.complaint}</td>
                      <td className="px-4 py-3">
                        {c.image ? (
                          <img src={c.image} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200" />
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </>
                  ) : c.kind === 'ba' && kind === 'ba' ? (
                    <>
                      <td className="px-4 py-3 font-medium text-slate-900">{c.baName}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{c.storeName}</div>
                        <div className="text-xs text-slate-500">{c.city}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{c.category}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-700">{c.subject}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            c.kind === 'customer'
                              ? 'bg-brand-50 text-brand-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {typeLabel(c.kind)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {c.kind === 'customer' ? c.customerName : c.baName}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {c.kind === 'customer' ? (
                          <>
                            <div className="font-medium text-slate-800">{c.brand}</div>
                            <div className="text-xs text-slate-500">{c.sku}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-slate-800">{c.storeName}</div>
                            <div className="text-xs text-slate-500">{c.category}</div>
                          </>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-700">
                        {c.kind === 'customer' ? c.complaint : c.subject}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 size={12} />
                      {formatComplaintDate(c.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" onClick={() => openDetail(c)}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={kind === 'customer' ? 10 : 8} className="px-4 py-10 text-center text-sm text-slate-500">
                    No complaints in this view.
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
        title={selected ? `${typeLabel(selected.kind)} complaint ${selected.id}` : 'Complaint'}
      >
        {selected && (
          <div className="space-y-4">
            {selected.kind === 'customer' ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Meta label="Type" value="Customer Complaint" />
                  <Meta label="Store" value={`${selected.storeName} · ${selected.city}`} />
                  <Meta label="Logged by" value={selected.baName} />
                  <Meta label="Name" value={selected.customerName} />
                  <Meta label="Number" value={selected.customerNumber} />
                  <Meta label="Brand" value={selected.brand} />
                  <Meta label="SKU" value={selected.sku} />
                  <Meta label="Status" value={selected.status} />
                </div>
                <div>
                  <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Complaint</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {selected.complaint}
                  </p>
                </div>
                {selected.image && (
                  <div>
                    <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Image</div>
                    <img
                      src={selected.image}
                      alt="Customer complaint"
                      className="mt-2 max-h-80 w-full rounded-xl object-contain ring-1 ring-slate-200"
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Meta label="Type" value="BA Complaint" />
                  <Meta label="Brand Ambassador" value={selected.baName} />
                  <Meta label="Store" value={`${selected.storeName} · ${selected.city}`} />
                  <Meta label="Category" value={selected.category} />
                  <Meta label="Status" value={selected.status} />
                </div>
                <div>
                  <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Subject</div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{selected.subject}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Details</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {selected.details}
                  </p>
                </div>
              </>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">HO note</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Internal note or resolution comment"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Button variant="secondary" onClick={() => setStatus('In Review')}>
                Mark In Review
              </Button>
              <Button variant="success" onClick={() => setStatus('Resolved')}>
                Resolve
              </Button>
              <Button variant="danger" onClick={() => setStatus('Rejected')}>
                Reject
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-900">{value}</div>
    </div>
  )
}
