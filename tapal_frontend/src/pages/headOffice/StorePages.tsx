import { Link, useParams } from 'react-router-dom'
import { ShiftPlanModal } from './ShiftPlanModal'
import { StoreFootfallCard, StoreSettingsCard, StoreShopperContentCard } from './StoreAdmin'
import { useEffect, useMemo, useState } from 'react'
import { stores } from '../../data/mock'
import {
  Avatar,
  Button,
  Card,
  Modal,
  PageHeader,
  ProgressBar,
  SearchInput,
  Select,
  StatusBadge,
  TableScroll,
} from '../../components/ui'
import { BookCheck, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, FileSpreadsheet, Plus } from 'lucide-react'
import { serverAmbassadorId, useSchedule, type MonthlyShift } from '../../context/ScheduleContext'
import { Time12Select } from '../../components/Time12Select'
import { StoreQrCard } from '../../components/StoreQrCard'
import { useBaAccounts } from '../../lib/baAccounts'
import { findCreatedStore, shopperPath, useCreatedStores } from '../../lib/storeRegistry'
import { BulkStoreModal, useRoleBase } from './StoreCreation'
import { portalGet, portalSend } from '../../lib/serverApi'

type CompetitorField = { id?: number; key: string; label: string; fieldType: 'text' | 'number'; scope: 'ALL' | 'CITY' | 'STORE'; city: string; storeId: number | null }

export function StoresPage() {
  const base = useRoleBase()
  const [bulkOpen, setBulkOpen] = useState(false)
  const [competitorFormSetOpen, setCompetitorFormSetOpen] = useState(false)
  useCreatedStores()
  useEffect(() => {
    void import('../../lib/djangoSync').then(({ syncDjango }) => syncDjango())
  }, [])

  return (
    <div>
      <PageHeader
        title="Stores"
        description={`${stores.length} outlets · prioritization by footfall, coverage & peak hours`}
        actions={
          <>
            <Link to={`${base}/stores/new`}>
              <Button>
                <Plus size={15} /> Create Store
              </Button>
            </Link>
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              <FileSpreadsheet size={15} /> Bulk upload
            </Button>
            <Button variant="secondary" onClick={() => setCompetitorFormSetOpen(true)}>
              <BookCheck size={15} /> Competitor Form Set
            </Button>
            <Link to={base === '/manager' ? '/manager/deployment' : '/ho/deployment'}>
              <Button variant="secondary">Open Scheduler</Button>
            </Link>
          </>
        }
      />
      <Card padding={false}>
        <TableScroll minWidth={820}>
          <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Store code</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Footfall</th>
              <th className="px-4 py-3">BAs</th>
              <th className="px-4 py-3">Coverage</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Shopper QR</th>
            </tr>
          </thead>
          <tbody>
            {stores.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  No stores yet. Create one and it is saved on the server.
                </td>
              </tr>
            )}
            {stores.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3 font-semibold tracking-wide text-slate-800">{s.storeCode || '—'}</td>
                <td className="px-4 py-3">
                  <Link to={`${base}/stores/${s.id}`} className="font-semibold text-brand-600 hover:underline">
                    #{s.id} {s.name}
                  </Link>
                  <div className="text-xs text-slate-400">{s.city}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.footfall} />
                </td>
                <td className="px-4 py-3">{s.bas}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <ProgressBar value={s.coverage} />
                    </div>
                    <span className="text-xs text-slate-500">{s.coverage}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3">
                  <Link to={`${base}/stores/${s.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                    View QR →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      </Card>
      <BulkStoreModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <CompetitorFormModal open={competitorFormSetOpen} onClose={() => setCompetitorFormSetOpen(false)} />
    </div>
  )
}

function CompetitorFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [scope, setScope] = useState<'ALL' | 'CITY' | 'STORE'>('ALL')
  const [city, setCity] = useState('')
  const [storeId, setStoreId] = useState('')
  const [fields, setFields] = useState<Array<{ key: string; label: string; fieldType: 'text' | 'number' }>>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const cities = [...new Set(stores.map((store) => store.city).filter(Boolean))].sort()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    void portalGet<{ results: CompetitorField[] }>('/api/competitor-fields/', 'office').then((data) => {
      const scoped = (data?.results ?? []).filter((row) => row.scope === scope &&
        (scope !== 'CITY' || row.city.toLowerCase() === city.toLowerCase()) &&
        (scope !== 'STORE' || String(row.storeId) === storeId))
      setFields(scoped.map(({ key, label, fieldType }) => ({ key, label, fieldType })))
      setLoading(false)
    })
  }, [open, scope, city, storeId])

  function addField() {
    setFields((current) => [...current, { key: `field-${Date.now()}-${current.length}`, label: '', fieldType: 'number' }])
  }

  async function save() {
    setError('')
    setSaving(true)
    try {
      await portalSend('/api/competitor-fields/', 'PUT', { scope, city, storeId: storeId ? Number(storeId) : null, fields }, 'office')
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the competitor form.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal open={open} onClose={onClose} title="Set competitor checkout form">
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Define the competitor brand names and the answer type BAs will see at checkout.</p>
      <label className="block text-sm"><span className="mb-1 block font-medium">Apply to</span>
        <Select className="w-full" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="ALL">All cities and stores</option><option value="CITY">City</option><option value="STORE">Store</option>
        </Select>
      </label>
      {scope === 'CITY' && <label className="block text-sm"><span className="mb-1 block font-medium">City</span><Select className="w-full" value={city} onChange={(e) => setCity(e.target.value)}><option value="">Choose a city</option>{cities.map((name) => <option key={name}>{name}</option>)}</Select></label>}
      {scope === 'STORE' && <label className="block text-sm"><span className="mb-1 block font-medium">Store</span><Select className="w-full" value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="">Choose a store</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.city})</option>)}</Select></label>}
      {loading ? <p className="text-sm text-slate-500">Loading saved fields…</p> : <div className="space-y-2">
        {fields.map((field, index) => <div key={field.key} className="grid grid-cols-[1fr_9rem_auto] gap-2">
          <input aria-label={`Brand name ${index + 1}`} className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Brand name / field label" value={field.label} onChange={(e) => setFields((list) => list.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} />
          <Select aria-label="Answer type" value={field.fieldType} onChange={(e) => setFields((list) => list.map((item, i) => i === index ? { ...item, fieldType: e.target.value as 'text' | 'number' } : item))}><option value="number">Number</option><option value="text">Text</option></Select>
          <Button variant="ghost" onClick={() => setFields((list) => list.filter((_, i) => i !== index))}>Remove</Button>
        </div>)}
        <Button variant="secondary" onClick={addField}><Plus size={14} /> Add field</Button>
      </div>}
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving || loading || (scope === 'CITY' && !city) || (scope === 'STORE' && !storeId)} onClick={() => void save()}>{saving ? 'Saving…' : 'Save form'}</Button></div>
    </div>
  </Modal>
}

export function StoreDetailPage() {
  const { id } = useParams()
  const base = useRoleBase()
  useCreatedStores()
  const store = stores.find((s) => String(s.id) === id)
  if (!store) {
    return (
      <div className="space-y-4">
        <Link to={`${base}/stores`} className="text-sm text-slate-500 hover:text-brand-600">
          ← Back to stores
        </Link>
        <Card>
          <p className="text-sm text-slate-600">This store is not on the server.</p>
        </Card>
      </div>
    )
  }
  const record = findCreatedStore(store.id)

  return (
    <div className="space-y-5">
      <Link to={`${base}/stores`} className="text-sm text-slate-500 hover:text-brand-600">
        ← Back to stores
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <StatusBadge status={store.status} />
            <h2 className="mt-2 text-2xl font-bold">{store.storeCode || `STORE #${store.id}`}</h2>
            <p className="text-slate-600">
              {store.name} · {store.city}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/ho/deployment">
              <Button variant="secondary">
                <CalendarClock size={15} /> Schedule BA
              </Button>
            </Link>
            <Link to={shopperPath(store)}>
              <Button>Open Shopper Experience</Button>
            </Link>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Today's Footfall" value={store.todayFootfall.toLocaleString()} />
          <Stat label="BA Coverage" value={`${store.coverage}%`} />
          <Stat label="Engagement" value={`${store.engagement}%`} />
          <Stat label="Conversion" value={`${store.conversion}%`} />
        </div>
      </Card>

      <StoreQrCard store={store} />

      {record && (
        <Card>
          <h3 className="mb-3 font-semibold">Store details</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Address" value={record.address} />
            <Detail label="Footfall" value={record.footfall} />
            <Detail
              label="Coordinates"
              value={record.latitude !== null && record.longitude !== null ? `${record.latitude}, ${record.longitude}` : ''}
            />
            <Detail label="Peak hours" value={record.peakHours} />
            <Detail label="Contact person" value={record.contactPerson} />
            <Detail label="Contact phone" value={record.contactPhone} />
          </dl>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <StoreFootfallCard key={`${store.id}-${store.todayFootfall}`} storeId={store.id} today={store.todayFootfall} />
        {record && <StoreSettingsCard key={record.id} record={record} inactive={store.status === 'Inactive'} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Assigned Ambassadors</h3>
          {store.assigned.length === 0 ? (
            <p className="text-sm text-slate-500">No BA has a shift here this month or is deployed here.</p>
          ) : (
            <div className="space-y-2">
              {store.assigned.map((a) => (
                <Link
                  key={a.id}
                  to={`/ho/ambassadors/${a.id}`}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 hover:bg-brand-50"
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={a.name} size="sm" />
                    <span className="text-sm font-medium">{a.name}</span>
                  </div>
                  <StatusBadge status={a.state === 'Active' ? 'On shift' : a.state} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Peak Hours</h3>
          <div className="space-y-3">
            {store.peak.map((p) => (
              <div
                key={p}
                className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium"
              >
                {p}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <StoreShopperContentCard storeId={store.id} />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value || '—'}</dd>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
    </div>
  )
}

export function DeploymentPage() {
  const [shiftsOpen, setShiftsOpen] = useState(false)
  const { reload } = useSchedule()
  return (
    <div className="space-y-5">
      <PageHeader
        title="Intelligent Store Deployment"
        description="Schedule certified BAs into peak shifts and activate QR"
        actions={
          <Button onClick={() => setShiftsOpen(true)}>
            <CalendarPlus size={15} /> Create shifts
          </Button>
        }
      />
      <SchedulerPanel />
      <ShiftPlanModal
        open={shiftsOpen}
        onClose={() => {
          setShiftsOpen(false)
          void reload()
        }}
      />
    </div>
  )
}

function SchedulerPanel() {
  const accounts = useBaAccounts()
  const assignable = useMemo(
    () =>
      accounts
        .map((a) => ({ ...a, serverId: serverAmbassadorId(a.id) }))
        .filter((a): a is typeof a & { serverId: number } => a.serverId !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )
  const { schedule, month, monthLabel, loading, error, shiftMonth, reload, saveShift, clearBaFromSlot, deleteShift } =
    useSchedule()
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [form, setForm] = useState({
    storeId: '',
    baId: '',
    startTime: '10:00',
    endTime: '18:00',
  })

  useEffect(() => {
    void reload()
  }, [reload])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return schedule
    return schedule.filter((s) =>
      [s.storeName, s.storeCode, s.city, s.baName, s.baCode].some((v) => (v ?? '').toLowerCase().includes(q)),
    )
  }, [schedule, query])
  const openCount = schedule.filter((s) => s.status === 'Open').length
  const filledCount = schedule.filter((s) => s.status === 'Scheduled').length
  const conflictCount = schedule.filter((s) => s.status === 'Conflict').length

  function flash(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }

  function openEditor(slot?: MonthlyShift) {
    setEditingId(slot?.id ?? null)
    setFormError(null)
    setForm({
      storeId: slot ? String(slot.storeId) : stores[0] ? String(stores[0].id) : '',
      baId: slot?.baId ?? '',
      startTime: slot?.startTime ?? '10:00',
      endTime: slot?.endTime ?? '18:00',
    })
    setModalOpen(true)
  }

  async function saveAssignment() {
    if (!form.storeId) {
      setFormError('Choose a store.')
      return
    }
    if (form.endTime <= form.startTime) {
      setFormError('End time must be after start time.')
      return
    }
    setSaving(true)
    const problem = await saveShift(
      {
        storeId: Number(form.storeId),
        month: editingId ? undefined : month,
        startTime: form.startTime,
        endTime: form.endTime,
        ambassadorId: form.baId ? Number(form.baId) : null,
      },
      editingId ?? undefined,
    )
    setSaving(false)
    if (problem) {
      setFormError(problem)
      return
    }
    setModalOpen(false)
    const store = stores.find((s) => String(s.id) === form.storeId)
    const ba = assignable.find((a) => String(a.serverId) === form.baId)
    flash(ba ? `Scheduled ${ba.name} → ${store?.name ?? 'store'}` : `Open shift saved at ${store?.name ?? 'store'}`)
  }

  async function clearSlot(id: string) {
    const problem = await clearBaFromSlot(id)
    flash(problem ?? 'Ambassador removed from the shift')
  }

  async function removeSlot(slot: MonthlyShift) {
    if (!window.confirm(`Delete the ${slot.monthLabel} shift at ${slot.storeName}?`)) return
    const problem = await deleteShift(slot.id)
    flash(problem ?? 'Shift deleted')
  }

  const selectedStore = stores.find((s) => String(s.id) === form.storeId)

  return (
    <div className="space-y-5">
      {toast && (
        <div className="animate-fade-up rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-slate-500">Monthly shifts</div>
          <div className="text-2xl font-bold">{schedule.length}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Scheduled</div>
          <div className="text-2xl font-bold text-emerald-600">{filledCount}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Open (need BA)</div>
          <div className="text-2xl font-bold text-amber-600">{openCount}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Conflicts</div>
          <div className="text-2xl font-bold text-rose-600">{conflictCount}</div>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-900">Deployment scheduler</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={15} />
            </Button>
            <span className="min-w-[9rem] text-center text-sm font-medium text-slate-700">{monthLabel || '—'}</span>
            <Button size="sm" variant="secondary" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight size={15} />
            </Button>
            <Button size="sm" onClick={() => openEditor()}>
              <Plus size={14} /> Add shift
            </Button>
          </div>
        </div>

        {schedule.length > 0 && (
          <div className="mb-4">
            <SearchInput
              placeholder="Search store, BA name or code..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</div>
        ) : loading && schedule.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading shifts…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
            {schedule.length === 0 ? `No shifts for ${monthLabel || 'this month'}.` : 'No shifts match your search.'}{' '}
            {schedule.length === 0 && (
              <button className="font-semibold text-brand-600" onClick={() => openEditor()}>
                Add one
              </button>
            )}
          </div>
        ) : (
          <TableScroll minWidth={720}>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Ambassador</th>
                  <th className="px-4 py-3">Shift time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((slot) => (
                  <tr key={slot.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium">{slot.storeName}</div>
                      <div className="text-xs text-slate-400">
                        {[slot.storeCode, slot.city].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {slot.baName ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={slot.baName} size="sm" />
                          <div>
                            <div>{slot.baName}</div>
                            {slot.baCode && <div className="font-mono text-xs text-slate-400">{slot.baCode}</div>}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap">{slot.shift}</div>
                      {slot.peakRecommended && (
                        <span className="mt-1 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                          Peak recommended
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={slot.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEditor(slot)}>
                          {slot.baId ? 'Edit' : 'Assign'}
                        </Button>
                        {slot.baId && (
                          <Button size="sm" variant="ghost" onClick={() => void clearSlot(slot.id)}>
                            Clear
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void removeSlot(slot)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${editingId ? 'Edit shift' : 'New shift'} · ${
          (editingId && schedule.find((s) => s.id === editingId)?.monthLabel) || monthLabel
        }`}
      >
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Store</span>
            <Select
              className="w-full"
              value={form.storeId}
              onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))}
            >
              {stores.length === 0 && <option value="">No stores yet</option>}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.storeCode ? `${s.storeCode} · ` : `#${s.id} `}
                  {s.name} ({s.city})
                </option>
              ))}
            </Select>
          </label>
          {selectedStore && selectedStore.peak.length > 0 && (
            <div className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800">
              Peak hours recommended: {selectedStore.peak.join(' · ')}
            </div>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Brand Ambassador</span>
            <Select
              className="w-full"
              value={form.baId}
              onChange={(e) => setForm((f) => ({ ...f, baId: e.target.value }))}
            >
              <option value="">Unassigned (open shift)</option>
              {form.baId && !assignable.some((a) => String(a.serverId) === form.baId) && (
                <option value={form.baId}>
                  {schedule.find((s) => s.id === editingId)?.baName ?? `Ambassador ${form.baId}`}
                </option>
              )}
              {assignable.map((a) => (
                <option key={a.serverId} value={a.serverId}>
                  {a.name}
                  {a.baCode ? ` · ${a.baCode}` : ''}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Start time</span>
              <Time12Select value={form.startTime} onChange={(startTime) => setForm((f) => ({ ...f, startTime }))} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">End time</span>
              <Time12Select value={form.endTime} onChange={(endTime) => setForm((f) => ({ ...f, endTime }))} />
            </label>
          </div>
          <p className="text-xs text-slate-500">Same hours for the whole month, Karachi time.</p>
          {formError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{formError}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveAssignment()} disabled={saving}>
              {saving ? 'Saving…' : 'Save shift'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
