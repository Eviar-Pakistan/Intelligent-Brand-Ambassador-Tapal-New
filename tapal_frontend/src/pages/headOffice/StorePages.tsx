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
import { useAttendance } from './BaAttendancePage'
import { findCreatedStore, shopperPath, useCreatedStores } from '../../lib/storeRegistry'
import { BulkStoreModal, useRoleBase } from './StoreCreation'
import { portalGet, portalSend } from '../../lib/serverApi'
import { djangoFetch } from '../../lib/djangoApi'

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
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { data: todayAttendance } = useAttendance(todayKey, todayKey)
  const store = stores.find((s) => String(s.id) === id)
  const backupCoverage = (todayAttendance?.results ?? []).filter(
    (row) => row.storeId === store?.id && !!row.coverageOfName && !row.coverageCancelled,
  )
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
          {store.assigned.length === 0 && backupCoverage.length === 0 ? (
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
              {backupCoverage.map((row) => (
                <Link
                  key={`coverage-${row.id}`}
                  to={`/ho/ambassadors/api-${row.baId}`}
                  className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 hover:bg-violet-100"
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={row.baName} size="sm" />
                    <div>
                      <div className="text-sm font-medium text-violet-900">{row.baName} · Backup BA</div>
                      <div className="text-xs text-violet-700">Covering for {row.coverageOfName} today</div>
                    </div>
                  </div>
                  <StatusBadge status="Covering" />
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
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const { data: todayAttendance } = useAttendance(todayKey, todayKey)
  const [backupPoolLoading, setBackupPoolLoading] = useState(true)
  useEffect(() => {
    let mounted = true
    void import('../../lib/djangoSync')
      .then(({ syncDjango }) => syncDjango())
      .finally(() => {
        if (mounted) setBackupPoolLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])
  const assignable = useMemo(
    () =>
      accounts
        .map((a) => ({ ...a, serverId: serverAmbassadorId(a.id) }))
        .filter((a): a is typeof a & { serverId: number } => a.serverId !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )
  const backupPool = useMemo(
    () => assignable.filter((a) => a.isBackup && !a.isDemoAccount && a.isActive !== false),
    [assignable],
  )
  const {
    schedule,
    month,
    monthLabel,
    loading,
    error,
    shiftMonth,
    reload,
    saveShift,
    swapShifts,
    clearBaFromSlot,
    deleteShift,
  } = useSchedule()
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapFirst, setSwapFirst] = useState('')
  const [swapSecond, setSwapSecond] = useState('')
  const [swapSaving, setSwapSaving] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [coverOpen, setCoverOpen] = useState(false)
  const [coverShift, setCoverShift] = useState<MonthlyShift | null>(null)
  const [coverStartDate, setCoverStartDate] = useState('')
  const [coverBackupId, setCoverBackupId] = useState('')
  const [coverSaving, setCoverSaving] = useState(false)
  const [endingCoverageId, setEndingCoverageId] = useState<number | null>(null)
  const [coverageToEnd, setCoverageToEnd] = useState<MonthlyShift | null>(null)
  const [coverageResumeDate, setCoverageResumeDate] = useState(todayKey)
  const [coverageEndError, setCoverageEndError] = useState<string | null>(null)
  const [coverError, setCoverError] = useState<string | null>(null)

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
    // Overnight shifts allowed (e.g. 5:00 PM → 1:00 AM).
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
  const assignedShifts = schedule.filter((slot) => slot.baId)

  async function confirmSwap() {
    if (!swapFirst || !swapSecond || swapFirst === swapSecond) {
      setSwapError('Choose two different assigned shifts.')
      return
    }
    setSwapSaving(true)
    setSwapError(null)
    const problem = await swapShifts(swapFirst, swapSecond)
    setSwapSaving(false)
    if (problem) {
      setSwapError(problem)
      return
    }
    setSwapOpen(false)
    flash('BA assignments swapped successfully')
  }

  function openCoverage(slot: MonthlyShift) {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    setCoverShift(slot)
    setCoverStartDate(slot.month === today.slice(0, 7) ? today : `${slot.month}-01`)
    setCoverBackupId('')
    setCoverError(null)
    setCoverOpen(true)
  }

  async function saveCoverage() {
    if (!coverShift || !coverStartDate || !coverBackupId) {
      setCoverError('Choose a start date and a backup BA.')
      return
    }
    setCoverSaving(true)
    setCoverError(null)
    try {
      const response = await djangoFetch('/api/shift-days/cover/', {
        method: 'POST',
        body: JSON.stringify({
          monthly_shift_id: Number(coverShift.id),
          start_date: coverStartDate,
          backup_ambassador_id: Number(coverBackupId),
        }),
      })
      const data = (await response.json().catch(() => ({}))) as { detail?: string }
      if (!response.ok) throw new Error(data.detail || 'Coverage could not be assigned.')
      const backup = backupPool.find((item) => String(item.serverId) === coverBackupId)
      setCoverOpen(false)
      flash(`${backup?.name ?? 'Backup BA'} is covering ${coverShift.baName} at ${coverShift.storeName} until coverage is ended`)
      await reload()
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : 'Coverage could not be assigned.')
    } finally {
      setCoverSaving(false)
    }
  }

  async function endCoverage(slot: MonthlyShift) {
    if (!slot.backupCoverage) return
    setCoverageToEnd(slot)
    const firstAllowedResume = new Date(`${slot.backupCoverage.startsOn}T00:00:00`)
    firstAllowedResume.setDate(firstAllowedResume.getDate() + 1)
    const firstAllowedKey = `${firstAllowedResume.getFullYear()}-${String(firstAllowedResume.getMonth() + 1).padStart(2, '0')}-${String(firstAllowedResume.getDate()).padStart(2, '0')}`
    setCoverageResumeDate(firstAllowedKey > todayKey ? firstAllowedKey : todayKey)
    setCoverageEndError(null)
  }

  const coverageResumeMin = coverageToEnd?.backupCoverage
    ? (() => {
        const firstAllowedResume = new Date(`${coverageToEnd.backupCoverage.startsOn}T00:00:00`)
        firstAllowedResume.setDate(firstAllowedResume.getDate() + 1)
        const firstAllowedKey = `${firstAllowedResume.getFullYear()}-${String(firstAllowedResume.getMonth() + 1).padStart(2, '0')}-${String(firstAllowedResume.getDate()).padStart(2, '0')}`
        return firstAllowedKey > todayKey ? firstAllowedKey : todayKey
      })()
    : todayKey

  async function confirmEndCoverage() {
    const slot = coverageToEnd
    const coverage = slot?.backupCoverage
    if (!slot || !coverage || !coverageResumeDate) return
    setEndingCoverageId(coverage.id)
    setCoverageEndError(null)
    try {
      const response = await djangoFetch('/api/shift-days/end-coverage/', {
        method: 'POST',
        body: JSON.stringify({ coverage_id: coverage.id, resume_on: coverageResumeDate }),
      })
      const data = (await response.json().catch(() => ({}))) as { detail?: string }
      if (!response.ok) throw new Error(data.detail || 'Coverage could not be ended.')
      setCoverageToEnd(null)
      flash(`Coverage ended. ${slot.baName} resumes on ${coverageResumeDate}; backup history is retained.`)
      await reload()
    } catch (error) {
      setCoverageEndError(error instanceof Error ? error.message : 'Coverage could not be ended.')
    } finally {
      setEndingCoverageId(null)
    }
  }

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
            <Button
              size="sm"
              variant="secondary"
              disabled={assignedShifts.length < 2}
              onClick={() => {
                setSwapFirst('')
                setSwapSecond('')
                setSwapError(null)
                setSwapOpen(true)
              }}
            >
              Swap BAs
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
                            {slot.backupCoverage && (
                              <div className="mt-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800">
                                Backup covering: {slot.backupCoverage.baName} · since {slot.backupCoverage.startsOn}
                                {slot.backupCoverage.endsOn && slot.backupCoverage.endsOn < slot.backupCoverage.startsOn
                                  ? ' · cancelled before start'
                                  : slot.backupCoverage.endsOn
                                    ? ` · through ${slot.backupCoverage.endsOn}`
                                    : ' · ongoing'}
                              </div>
                            )}
                            {(todayAttendance?.results ?? [])
                              .filter((day) => day.storeId === slot.storeId && day.coverageOfName === slot.baName && !day.coverageCancelled)
                              .map((day) => (
                                <div key={day.id} className="mt-1 rounded-md bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">
                                  Backup working here today: {day.baName}
                                </div>
                              ))}
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
                        {slot.baId && (!slot.backupCoverage || !!slot.backupCoverage.endedAt) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={slot.month < new Date().toISOString().slice(0, 7)}
                            onClick={() => openCoverage(slot)}
                            title={backupPool.length ? 'Assign ongoing backup coverage' : 'View backup eligibility and assign a backup'}
                          >
                            Cover
                          </Button>
                        )}
                        {slot.baId && (
                          <Button size="sm" variant="ghost" onClick={() => void clearSlot(slot.id)}>
                            Clear
                          </Button>
                        )}
                        {slot.backupCoverage && !slot.backupCoverage.endedAt && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={endingCoverageId === slot.backupCoverage.id}
                            onClick={() => void endCoverage(slot)}
                          >
                            {endingCoverageId === slot.backupCoverage.id ? 'Ending…' : 'End cover'}
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

      <Modal open={swapOpen} onClose={() => setSwapOpen(false)} title={`Swap BAs · ${monthLabel || month}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Select the two assigned shifts. The BAs will exchange stores for this month. Past and checked-in attendance
            records are preserved. If either BA has started a shift today, both assignments for today stay as scheduled
            and the swap applies from tomorrow.
          </p>
          {[{ label: 'First shift', value: swapFirst, set: setSwapFirst }, { label: 'Second shift', value: swapSecond, set: setSwapSecond }].map((item) => (
            <label key={item.label} className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{item.label}</span>
              <Select className="w-full" value={item.value} onChange={(e) => item.set(e.target.value)}>
                <option value="">Choose an assigned shift…</option>
                {assignedShifts.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.baName} · {slot.storeName} · {slot.shift}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          <p className="text-xs text-slate-500">The swap will be blocked if it creates overlapping BA shift hours.</p>
          {swapError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{swapError}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setSwapOpen(false)} disabled={swapSaving}>
              Cancel
            </Button>
            <Button onClick={() => void confirmSwap()} disabled={swapSaving || !swapFirst || !swapSecond || swapFirst === swapSecond}>
              {swapSaving ? 'Swapping…' : 'Confirm swap'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={coverOpen}
        onClose={() => setCoverOpen(false)}
        title={coverShift ? `Assign backup · ${coverShift.storeName}` : 'Assign backup'}
      >
        <div className="space-y-3">
          {coverShift && (
            <p className="text-sm text-slate-600">
              {coverShift.baName} will remain marked Absent. The backup will record their own attendance, while reports
              and target credit go to {coverShift.baName}. Coverage continues across scheduled days and months until you end it.
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Coverage starts on</span>
            <input
              type="date"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={coverStartDate}
              min={new Date().toISOString().slice(0, 10)}
              max={coverShift ? `${coverShift.month}-${String(new Date(Number(coverShift.month.slice(0, 4)), Number(coverShift.month.slice(5, 7)), 0).getDate()).padStart(2, '0')}` : undefined}
              onChange={(event) => setCoverStartDate(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Backup BA</span>
            <Select className="w-full" value={coverBackupId} onChange={(event) => setCoverBackupId(event.target.value)}>
              <option value="">{backupPoolLoading ? 'Loading backup BAs…' : 'Choose a backup BA…'}</option>
              {backupPool.map((ba) => (
                <option key={ba.serverId} value={ba.serverId}>{ba.name}{ba.baCode ? ` · ${ba.baCode}` : ''}</option>
              ))}
            </Select>
            {backupPoolLoading && (
              <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
                Loading the BA roster…
              </span>
            )}
            {!backupPoolLoading && backupPool.length === 0 && (
              <span className="mt-1 block text-xs text-amber-700">
                No available backup BAs yet. Mark an available BA as a backup from their profile or when creating the BA.
              </span>
            )}
          </label>
          {coverError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{coverError}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCoverOpen(false)} disabled={coverSaving}>Cancel</Button>
            <Button onClick={() => void saveCoverage()} disabled={coverSaving || backupPoolLoading || !coverStartDate || !coverBackupId}>
              {coverSaving ? 'Assigning…' : backupPoolLoading ? 'Loading…' : 'Assign backup'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!coverageToEnd}
        onClose={() => !endingCoverageId && setCoverageToEnd(null)}
        title="End backup coverage"
      >
        {coverageToEnd?.backupCoverage && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {coverageToEnd.backupCoverage.baName} is covering {coverageToEnd.baName} at {coverageToEnd.storeName}.
              Coverage will end the day before the original BA resumes. The backup’s first covered day is retained. Past attendance and reports stay saved.
            </p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Original BA resumes on</span>
              <input
                type="date"
                min={coverageResumeMin}
                value={coverageResumeDate}
                onChange={(event) => setCoverageResumeDate(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </label>
            {coverageEndError && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{coverageEndError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCoverageToEnd(null)} disabled={!!endingCoverageId}>Cancel</Button>
              <Button onClick={() => void confirmEndCoverage()} disabled={!!endingCoverageId || !coverageResumeDate}>
                {endingCoverageId ? 'Ending…' : 'End coverage'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
