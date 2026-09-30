import { Link, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ambassadors, type LifecycleStage } from '../../data/mock'
import {
  Avatar,
  Button,
  Card,
  Modal,
  PageHeader,
  ProgressRing,
  ScoreBars,
  SearchInput,
  StatusBadge,
  TableScroll,
  Tabs,
} from '../../components/ui'
import { Check, Copy, Download, ExternalLink, FileSpreadsheet, Upload, UserPlus, X } from 'lucide-react'
import {
  baAccessUrl,
  baEmailInUse,
  createBaAccount,
  createBaAccounts,
  downloadAmbassadorTemplate,
  downloadBaLinks,
  isDemoBa,
  parseAmbassadorFile,
  useBaAccounts,
  type AmbassadorParseResult,
  type BaAccount,
} from '../../lib/baAccounts'
import { AssessmentReport } from '../ba/AssessmentReport'
import {
  describeSkuUpload,
  isStoreSkuSheet,
  uploadStoreSkuTargets,
  type StoreSkuUploadResult,
} from '../../lib/storeSkuTargets'
import { BaShiftsCard } from './BaShiftsCard'
import { serverAmbassadorId } from '../../context/ScheduleContext'
import { AmbassadorProfile } from './AmbassadorProfile'
import { timeOf, useAttendance } from './BaAttendancePage'
import { useDailyReports } from '../../lib/baReport'
import { ShiftPlanModal } from './ShiftPlanModal'
import { buildIncentiveRoster, formatPkr } from '../../lib/incentives'
import {
  achievementPct,
  currentMonthKey,
  downloadTargetTemplate,
  formatTargetMonth,
  parseTargetFile,
  saveBaTargetsToServer,
  setBaMonthTarget,
  setBaMonthTargets,
  targetForBa,
  useBaTargets,
  type BaMonthTarget,
  type TargetParseResult,
  type TargetPerson,
} from '../../lib/baTargets'
import { groupByRange, loadSkuCatalogue, type SkuRow } from '../../lib/skuCatalogue'

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

/** YYYY-MM-DD in the device's local time. */
function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const allLifecycle: LifecycleStage[] = [
  'Recruited',
  'AI Screened',
  'Certified',
  'Trained',
  'Deployed',
  'Live'
]

const modalFieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500'

function AccountLinkPanel({ account }: { account: BaAccount }) {
  const [copied, setCopied] = useState(false)
  const url = baAccessUrl(account)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked — the link is selectable above
    }
  }

  return (
    <div className="space-y-3">
      <pre className="rounded-xl bg-slate-50 px-4 py-3 font-mono text-xs break-all whitespace-pre-wrap text-slate-700">
        {url}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          <Copy size={14} /> {copied ? 'Copied!' : 'Copy link'}
        </Button>
        <Button type="button" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
          <ExternalLink size={14} /> Open account
        </Button>
      </div>
    </div>
  )
}

function AccountLinkModal({
  account,
  title,
  onClose,
}: {
  account: BaAccount | null
  title: string
  onClose: () => void
}) {
  const accounts = useBaAccounts()
  const live = account ? (accounts.find((item) => item.id === account.id) ?? account) : null
  return (
    <Modal open={!!live} onClose={onClose} title={title}>
      {live && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Share this link with {live.name}. Opening it takes them straight into their account. There is no
            password.
          </p>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">BA code</div>
            <div className="mt-1 font-mono text-lg font-semibold text-slate-900">{live.baCode || '—'}</div>
          </div>
          <AccountLinkPanel account={live} />
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function CreateAmbassadorModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (account: BaAccount) => void
}) {
  const fresh = () => ({ name: '', city: '', email: '', phone: '' })
  const [form, setForm] = useState(fresh)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function close() {
    setForm(fresh())
    setError(null)
    setBusy(false)
    onClose()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) return setError('Name is required.')
    // Email is optional; when given it must be valid and not used by another ambassador.
    if (form.email.trim() && !validEmail(form.email)) return setError('Enter a valid email.')
    if (baEmailInUse(form.email)) return setError('Another ambassador already uses this email.')
    setBusy(true)
    try {
      const account = await createBaAccount(form)
      onCreated(account)
      close()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Could not save this ambassador.')
    }
  }

  const set = (key: 'name' | 'city' | 'email' | 'phone') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [key]: e.target.value })
    setError(null)
  }

  return (
    <Modal open={open} onClose={close} title="Create Ambassador">
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name *</span>
          <input value={form.name} onChange={set('name')} className={modalFieldClass} autoFocus />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">City</span>
          <input value={form.city} onChange={set('city')} className={modalFieldClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input type="email" value={form.email} onChange={set('email')} className={modalFieldClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Phone</span>
          <input type="tel" value={form.phone} onChange={set('phone')} className={modalFieldClass} />
        </label>
        <p className="text-xs text-slate-500">
          A unique BA code is created automatically. After you save, you get that code and a personal link.
        </p>
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Create ambassador'}
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Download the template → fill it in → upload it → review → create many ambassador accounts at once. */
function BulkAmbassadorModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (accounts: BaAccount[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<AmbassadorParseResult | null>(null)

  function close() {
    setResult(null)
    setFileName('')
    onClose()
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setFileName(file.name)
    setResult(await parseAmbassadorFile(file))
    setBusy(false)
  }

  return (
    <Modal open={open} onClose={close} title="Create ambassadors from Excel">
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <div className="font-semibold text-slate-900">1. Download the template</div>
          <p className="text-xs text-slate-500">
            Fill in one ambassador per row. Only Name is required. Each row gets its own BA code when you create them.
          </p>
          <Button variant="secondary" onClick={() => void downloadAmbassadorTemplate()}>
            <Download size={14} /> Download ambassador template
          </Button>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="font-semibold text-slate-900">2. Upload the filled template</div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload size={14} /> {busy ? 'Checking…' : result ? 'Choose another file' : 'Upload Excel file'}
            </Button>
            {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
          </div>
        </div>

        {result && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            {result.rows.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                {result.rows.length} {result.rows.length === 1 ? 'ambassador is' : 'ambassadors are'} ready to create.
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                <div className="font-semibold">
                  {result.rows.length > 0
                    ? `${result.errors.length} ${result.errors.length === 1 ? 'row' : 'rows'} will be skipped:`
                    : 'Nothing can be created yet:'}
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {result.errors.slice(0, 8).map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
                {result.errors.length > 8 && <div className="mt-1 font-medium">…and {result.errors.length - 8} more</div>}
              </div>
            )}
            {result.rows.length > 0 && (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true)
                    try {
                      const created = await createBaAccounts(result.rows.map((r) => r.input))
                      close()
                      onCreated(created)
                    } catch (err) {
                      setBusy(false)
                      setResult({
                        ...result,
                        errors: [
                          err instanceof Error ? err.message : 'Could not save these ambassadors.',
                          ...result.errors,
                        ],
                      })
                    }
                  })()
                }}
              >
                Create {result.rows.length} {result.rows.length === 1 ? 'ambassador' : 'ambassadors'}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function AmbassadorDetailModal({
  account,
  onClose,
}: {
  account: BaAccount | null
  onClose: () => void
}) {
  return (
    <Modal open={!!account} onClose={onClose} title={account ? account.name : 'Ambassador'}>
      {account && (
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <StatusBadge status={account.status} />
            <span className="text-xs text-slate-500">
              {[account.storeName, account.city, account.email, account.phone].filter(Boolean).join(' · ') || 'No contact details'}
            </span>
          </div>

          {account.result ? (
            <AssessmentReport name={account.name} result={account.result} />
          ) : (
            <p className="text-slate-600">
              {account.videoWatched
                ? `Training video watched · ${account.answers.length} assessment answer${account.answers.length === 1 ? '' : 's'} submitted so far.`
                : 'Has not finished the training video yet.'}
            </p>
          )}

          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">BA code</div>
            <div className="mb-4 font-mono text-lg font-semibold text-slate-900">{account.baCode || '—'}</div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Account link</div>
            <AccountLinkPanel account={account} />
            <Link
              to={`/ho/ambassadors/${account.id}`}
              className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              Open profile — scores, deploy, edit, deactivate →
            </Link>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Excel of the listed BAs: name, store, personal access link and city (to send each BA their link). */
async function downloadBaAccessLinks(rows: BaAccount[]) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['BA Name', 'Store', 'Access Link', 'City'],
    ...rows.map((a) => [a.name, a.storeName || '', a.accessToken ? baAccessUrl(a) : '', a.city || '']),
  ])
  sheet['!cols'] = [{ wch: 26 }, { wch: 34 }, { wch: 70 }, { wch: 16 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'BA Access Links')
  XLSX.writeFile(book, `Tapal_BA_Access_Links_${localDay(new Date())}.xlsx`)
}

export function AmbassadorsPage() {
  const [tab, setTab] = useState('All')
  const [q, setQ] = useState('')
  const accounts = useBaAccounts()
  const monthTargets = useBaTargets()
  const targetMonth = currentMonthKey()
  const today = localDay(new Date())
  const { data: todayAttendance } = useAttendance(today, today)
  const reports = useDailyReports()
  // Today's attendance per BA (a BA with two shifts: the one they checked in to first).
  const attendanceByBa = useMemo(() => {
    const map = new Map<string, { checkedInAt: string | null; checkedOutAt: string | null; reported: boolean }>()
    for (const row of todayAttendance?.results ?? []) {
      const key = `api-${row.baId}`
      const prev = map.get(key)
      if (!prev || (!prev.checkedInAt && row.checkedInAt)) {
        map.set(key, {
          checkedInAt: row.checkedInAt,
          checkedOutAt: row.checkedOutAt,
          reported: !!row.reportSubmittedAt || !!prev?.reported,
        })
      }
    }
    return map
  }, [todayAttendance])
  const reportedToday = useMemo(
    () => new Set(reports.filter((r) => localDay(new Date(r.submittedAt)) === today).map((r) => r.baId)),
    [reports, today],
  )
  const [createOpen, setCreateOpen] = useState(false)
  const [linkPrompt, setLinkPrompt] = useState<{ account: BaAccount; title: string } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkCreated, setBulkCreated] = useState<BaAccount[] | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetBulkOpen, setTargetBulkOpen] = useState(false)

  useEffect(() => {
    void import('../../lib/djangoSync').then(({ syncDjango }) => syncDjango())
  }, [])

  const filteredAccounts = accounts.filter((a) => {
    if (isDemoBa(a.id)) return false
    const matchTab = tab === 'All' || (a.status === 'Invited' ? tab === 'Pending' : a.status === tab)
    const query = q.toLowerCase()
    return matchTab && (a.name.toLowerCase().includes(query) || (a.storeName ?? '').toLowerCase().includes(query))
  })

  return (
    <div>
      <PageHeader
        title="Ambassadors"
        description="Full BA lifecycle — recruitment through live performance"
        actions={
          <>
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus size={15} /> Add ambassador
            </Button>
            <Button variant="secondary" onClick={() => setTargetOpen(true)}>
              Set SKU target
            </Button>
            <Button variant="secondary" onClick={() => setTargetBulkOpen(true)}>
              <FileSpreadsheet size={15} /> Upload targets
            </Button>
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              <FileSpreadsheet size={15} /> Bulk upload (Excel)
            </Button>
            <Button
              variant="secondary"
              disabled={filteredAccounts.length === 0}
              onClick={() => void downloadBaAccessLinks(filteredAccounts)}
            >
              <Download size={15} /> Download BA links
            </Button>

            <Link to="/ho/ambassadors/training">
              <Button variant="secondary">Training videos</Button>
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search ambassador..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Tabs tabs={['All', 'Certified', 'Training', 'Deployed', 'Pending']} value={tab} onChange={setTab} />
      </div>
      <Card padding={false}>
        <TableScroll>
          <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">BA code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">{formatTargetMonth(targetMonth).split(' ')[0]} target</th>
              <th className="px-4 py-3">Check-in</th>
              <th className="px-4 py-3">Check-out</th>
              <th className="px-4 py-3">Data filled</th>
              <th className="px-4 py-3">Open link</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-800">{a.baCode || '—'}</td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setDetailId(a.id)} className="flex items-center gap-3 text-left">
                    <Avatar name={a.name} />
                    <span className="font-medium text-slate-900 hover:text-brand-600">{a.name}</span>
                    {a.isActive === false && <StatusBadge status="Inactive" />}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.city || '—'}</td>
                <td className="px-4 py-3 font-semibold">{a.result ? `${a.result.quality}%` : '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge
                    status={a.result ? (a.result.certified ? 'Certified' : 'Rejected') : a.status}
                  />
                </td>
                <td className="px-4 py-3 text-slate-600">{a.storeName || '—'}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">
                  {targetForBa(a.id, targetMonth, monthTargets)?.targetKg.toLocaleString() ?? '—'}
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-700">
                  {timeOf(attendanceByBa.get(a.id)?.checkedInAt ?? null)}
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-700">
                  {timeOf(attendanceByBa.get(a.id)?.checkedOutAt ?? null)}
                </td>
                <td className="px-4 py-3">
                  {reportedToday.has(a.id) || attendanceByBa.get(a.id)?.reported ? (
                    <StatusBadge status="Submitted" />
                  ) : attendanceByBa.has(a.id) ? (
                    <StatusBadge status="Pending" />
                  ) : (
                    <span className="text-slate-400" title="No shift today">
                      —
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setLinkPrompt({ account: a, title: `${a.name} · account link` })}
                  >
                    <ExternalLink size={13} /> Open link
                  </Button>
                </td>
              </tr>
            ))}
            {filteredAccounts.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
                  No ambassadors yet. Add one to create an account link.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </TableScroll>
      </Card>

      <CreateAmbassadorModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(account) => {
          setCreateOpen(false)
          setLinkPrompt({ account, title: 'Ambassador created' })
        }}
      />

      <AccountLinkModal
        account={linkPrompt?.account ?? null}
        title={linkPrompt?.title ?? 'Account link'}
        onClose={() => setLinkPrompt(null)}
      />

      <BulkAmbassadorModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onCreated={(created) => setBulkCreated(created)}
      />

      <Modal open={!!bulkCreated} onClose={() => setBulkCreated(null)} title="Ambassadors created">
        {bulkCreated && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              {bulkCreated.length} {bulkCreated.length === 1 ? 'ambassador' : 'ambassadors'} created. Each one has a
              unique BA code. Share the account link — opening it enters that ambassador&apos;s account.
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              {bulkCreated.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailId(a.id)
                      setBulkCreated(null)
                    }}
                    className="font-medium hover:text-brand-600"
                  >
                    {a.name}
                    <span className="ml-2 font-mono text-xs text-slate-500">{a.baCode}</span>
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setBulkCreated(null)
                      setLinkPrompt({ account: a, title: `${a.name} · account link` })
                    }}
                  >
                    <ExternalLink size={13} /> Open link
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                className="w-full"
                onClick={() =>
                  void downloadBaLinks(
                    bulkCreated.map((a) => ({ name: a.name, email: a.email, code: a.baCode, url: baAccessUrl(a) })),
                  )
                }
              >
                <Download size={14} /> Download account links
              </Button>
              <Button variant="secondary" onClick={() => setBulkCreated(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <AmbassadorDetailModal
        account={accounts.find((a) => a.id === detailId) ?? null}
        onClose={() => setDetailId(null)}
      />

      <SetTargetModal open={targetOpen} onClose={() => setTargetOpen(false)} />
      <BulkTargetModal open={targetBulkOpen} onClose={() => setTargetBulkOpen(false)} />
    </div>
  )
}

function targetPeople(accounts: { id: string; name: string; baCode?: string }[]): TargetPerson[] {
  return accounts.map((account) => ({ id: account.id, name: account.name, baCode: account.baCode }))
}

/** Download the target template, fill Target Kg, then upload it to save many months at once. */
export function BulkTargetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useBaAccounts()
  const people = useMemo(() => targetPeople(accounts), [accounts])
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<TargetParseResult | null>(null)
  const [saved, setSaved] = useState(0)
  // Store SKU sheet (Store name | SKU Name | KG Count …): saved on the server for the store's BA(s)
  const [skuFile, setSkuFile] = useState<File | null>(null)
  const [skuMonth, setSkuMonth] = useState(currentMonthKey)
  const [skuResult, setSkuResult] = useState<StoreSkuUploadResult | null>(null)
  const [skuError, setSkuError] = useState<string | null>(null)

  function close() {
    setResult(null)
    setFileName('')
    setSaved(0)
    setSkuFile(null)
    setSkuResult(null)
    setSkuError(null)
    onClose()
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setSaved(0)
    setFileName(file.name)
    setSkuResult(null)
    setSkuError(null)
    if (await isStoreSkuSheet(file)) {
      setResult(null)
      setSkuFile(file)
    } else {
      setSkuFile(null)
      setResult(await parseTargetFile(file, people))
    }
    setBusy(false)
  }

  async function saveTargetRows(rows: BaMonthTarget[]) {
    setBusy(true)
    setSkuError(null)
    try {
      const outcome = await saveBaTargetsToServer(rows)
      setBaMonthTargets(rows.filter((row) => outcome.saved.some((s) => s.baCode === row.baCode && s.month === row.month)))
      setSaved(outcome.saved.length)
      setResult(outcome.errors.length ? { rows: [], errors: outcome.errors } : null)
    } catch (err) {
      setSkuError(err instanceof Error ? err.message : 'The targets could not be saved.')
    }
    setBusy(false)
  }

  async function saveSkuTargets() {
    if (!skuFile) return
    setBusy(true)
    setSkuError(null)
    try {
      const uploaded = await uploadStoreSkuTargets(skuFile, skuMonth)
      setSkuResult(uploaded)
      const { syncBaTargets } = await import('../../lib/djangoSync')
      await syncBaTargets(skuMonth)
    } catch (err) {
      setSkuError(err instanceof Error ? err.message : 'The targets could not be saved.')
    }
    setBusy(false)
  }

  return (
    <Modal open={open} onClose={close} title="Upload targets from Excel">
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <div className="font-semibold text-slate-900">1. Download the template</div>
          <p className="text-xs text-slate-500">
            Columns: BA Code, SKU, Month, Brand, Target Kg — one row per SKU, so a BA can have many SKU targets. The
            SKU is picked from the SKU list (brand comes with it). Sales are not entered: they come from each BA's
            Daily Sales reports, and achievement = sales ÷ target × 100. You can also upload a store SKU target sheet
            (Store name, SKU Name, KG Count): each store's targets go to that store's BA.
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              void downloadTargetTemplate().catch((err) =>
                setSkuError(err instanceof Error ? err.message : 'The template could not be downloaded.'),
              )
            }
          >
            <Download size={14} /> Download target template
          </Button>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="font-semibold text-slate-900">2. Upload the filled template</div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={(event) => {
              void onFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload size={14} /> {busy ? 'Checking…' : result ? 'Choose another file' : 'Upload Excel file'}
            </Button>
            {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
          </div>
        </div>

        {saved > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
            Saved {saved} {saved === 1 ? 'target' : 'targets'}.
          </div>
        )}

        {skuError && !skuFile && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{skuError}</p>
        )}

        {skuFile && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              SKU target sheet for {formatTargetMonth(skuMonth)}. Each store's KG targets go to the BA in its BA Code
              column (or every BA of the store when BA Code is empty).
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Month</span>
              <input
                type="month"
                value={skuMonth}
                onChange={(e) => {
                  setSkuMonth(e.target.value)
                  setSkuResult(null)
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              />
            </label>
            {skuResult && skuResult.saved.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                <div className="font-semibold">
                  Saved for {skuResult.saved.length} {skuResult.saved.length === 1 ? 'BA' : 'BAs'}:
                </div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {skuResult.saved.map((row) => (
                    <li key={`${row.baCode}-${row.store}`}>
                      {row.baName} {row.baCode && <span className="font-mono">({row.baCode})</span>} · {row.store} ·{' '}
                      {row.targetKg.toLocaleString()} kg
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {skuResult && describeSkuUpload(skuResult).length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                <div className="font-semibold">Not saved:</div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {describeSkuUpload(skuResult).slice(0, 8).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {skuError && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{skuError}</p>
            )}
            {!skuResult?.saved.length && (
              <Button className="w-full" disabled={busy || !skuMonth} onClick={() => void saveSkuTargets()}>
                {busy ? 'Saving…' : 'Save targets for BAs'}
              </Button>
            )}
          </div>
        )}

        {result && saved === 0 && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            {result.rows.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                {result.rows.length} {result.rows.length === 1 ? 'target is' : 'targets are'} ready to save.
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                <div className="font-semibold">
                  {result.rows.length > 0
                    ? `${result.errors.length} ${result.errors.length === 1 ? 'row' : 'rows'} will be skipped:`
                    : 'Nothing can be saved yet:'}
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {result.errors.slice(0, 8).map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
                {result.errors.length > 8 && <div className="mt-1 font-medium">…and {result.errors.length - 8} more</div>}
              </div>
            )}
            {result.rows.length > 0 && (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => void saveTargetRows(result.rows)}
              >
                Save {result.rows.length} {result.rows.length === 1 ? 'target' : 'targets'}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function SetTargetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useBaAccounts()
  const targets = useBaTargets()
  const people = useMemo(() => targetPeople(accounts), [accounts])
  const [baId, setBaId] = useState(people[0]?.id ?? '')
  const [month, setMonth] = useState(currentMonthKey)
  // One row per SKU: which SKU and its Target Kg. Units = kg / the SKU's grammage.
  // Sales come from the BA's reports, not from here.
  const [lines, setLines] = useState<{ sku: string; qty: string }[]>([])
  const [catalogue, setCatalogue] = useState<SkuRow[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existing = targetForBa(baId, month, targets)

  useEffect(() => {
    if (!open || catalogue) return
    void loadSkuCatalogue().then(setCatalogue)
  }, [open, catalogue])

  useEffect(() => {
    if (!open) return
    const row = targetForBa(baId, month, targets)
    const current = (row?.lines ?? []).map((line) => ({ sku: line.sku, qty: String(line.qty) }))
    setLines(current.length ? current : [{ sku: '', qty: '' }])
  }, [open, baId, month, targets])

  const ranges = useMemo(() => groupByRange(catalogue ?? []), [catalogue])
  const gramsOf = useMemo(() => new Map((catalogue ?? []).map((row) => [row.sku, row.grammage])), [catalogue])
  const kgOf = (line: { sku: string; qty: string }) => Number(line.qty) || 0
  const unitsOf = (line: { sku: string; qty: string }) => {
    const grams = gramsOf.get(line.sku) ?? 0
    return grams ? Math.round((kgOf(line) / grams) * 100) / 100 : null
  }
  const filled = lines.filter((line) => line.sku && line.qty !== '')
  const totalKg = Math.round(filled.reduce((sum, line) => sum + kgOf(line), 0) * 1000) / 1000
  const invalid = filled.some((line) => !Number.isFinite(Number(line.qty)) || Number(line.qty) < 0)
  const duplicate = new Set(filled.map((line) => line.sku)).size !== filled.length

  function updateLine(index: number, patch: Partial<{ sku: string; qty: string }>) {
    setSaved(false)
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  async function save() {
    const person = people.find((item) => item.id === baId)
    if (!person || filled.length === 0 || invalid || duplicate) return
    const info = new Map((catalogue ?? []).map((row) => [row.sku, row]))
    const targetLines = filled.map((line) => ({
      sku: line.sku,
      qty: kgOf(line),
      count: unitsOf(line),
      brand: info.get(line.sku)?.range,
      grammage: info.get(line.sku)?.grammage,
    }))
    const row: BaMonthTarget = {
      baId: person.id,
      baName: person.name,
      baCode: person.baCode,
      month,
      targetKg: totalKg,
      salesKg: existing?.salesKg ?? 0,
      lines: targetLines,
    }
    setError(null)
    if (!person.baCode) {
      // sample accounts have no server record
      setBaMonthTarget(row)
      setSaved(true)
      return
    }
    setBusy(true)
    try {
      const outcome = await saveBaTargetsToServer([row])
      if (outcome.errors.length) throw new Error(outcome.errors[0])
      setBaMonthTarget(row)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The target could not be saved.')
    }
    setBusy(false)
  }

  return (
    <Modal open={open} onClose={onClose} title="Set SKU target">
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Ambassador</span>
          <select
            value={baId}
            onChange={(e) => {
              setSaved(false)
              setBaId(e.target.value)
            }}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setSaved(false)
              setMonth(e.target.value)
            }}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <div className="text-sm">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-slate-700">SKU targets (kg)</span>
            <span className="text-xs text-slate-500 tabular-nums">Total {totalKg.toLocaleString()} kg</span>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={line.sku}
                  onChange={(e) => updateLine(index, { sku: e.target.value })}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-sm outline-none focus:border-brand-500"
                >
                  <option value="">{catalogue === null ? 'Loading SKUs…' : 'Choose SKU…'}</option>
                  {/* A SKU saved earlier that is no longer in the SKU list is shown so it can be replaced. */}
                  {line.sku && catalogue !== null && !catalogue.some((row) => row.sku === line.sku) && (
                    <option value={line.sku} disabled>
                      {line.sku} (not in SKU list — choose another)
                    </option>
                  )}
                  {ranges.map((group) => (
                    <optgroup key={group.range} label={group.range}>
                      {group.skus.map((sku) => (
                        <option key={sku} value={sku}>
                          {sku}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="w-28 shrink-0">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    placeholder="Kg"
                    value={line.qty}
                    onChange={(e) => updateLine(index, { qty: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-sm outline-none focus:border-brand-500"
                  />
                  {line.sku && line.qty !== '' && (
                    <div className="mt-0.5 text-right text-[10px] text-slate-500 tabular-nums">
                      ÷ {gramsOf.get(line.sku) ?? '?'} = {unitsOf(line) ?? '—'} units
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Remove SKU"
                  onClick={() => {
                    setSaved(false)
                    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [{ sku: '', qty: '' }]))
                  }}
                  className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { sku: '', qty: '' }])}
            className="mt-2 text-xs font-semibold text-brand-600 hover:underline"
          >
            + Add SKU
          </button>
          {duplicate && <p className="mt-1 text-xs text-rose-700">Each SKU can be added only once.</p>}
          {existing && (
            <p className="mt-2 text-xs text-slate-500">
              Sales so far this month: {existing.salesKg.toLocaleString()} kg from the BA&apos;s Daily Sales reports ·
              achievement {achievementPct(existing.targetKg, existing.salesKg)}%.
            </p>
          )}
        </div>
        {saved && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Saved for this ambassador and month.
          </p>
        )}
        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        )}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          <Button onClick={() => void save()} disabled={busy || filled.length === 0 || invalid || duplicate}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function AmbassadorProfilePage() {
  const { id } = useParams()
  const accounts = useBaAccounts()
  const account = accounts.find((item) => item.id === id) ?? null
  const ba = ambassadors.find((a) => a.id === id)
  const [shiftOpen, setShiftOpen] = useState(false)
  const incentive = buildIncentiveRoster().find((r) => r.baId === ba?.id)
  const today = localDay(new Date())
  const { data: todayAttendance } = useAttendance(today, today, account ? serverAmbassadorId(account.id) : null)
  const onShiftToday = (todayAttendance?.results ?? []).some((r) => r.checkedInAt && !r.checkedOutAt)

  if (!ba) {
    return (
      <div className="space-y-5">
        <Link to="/ho/ambassadors" className="text-sm text-slate-500 hover:text-brand-600">
          ← Back to ambassadors
        </Link>
        {account ? (
          <>
            <AmbassadorProfile account={account} onShiftToday={onShiftToday} />
            <Card>
              <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Account link</div>
              <AccountLinkPanel account={account} />
            </Card>
          </>
        ) : (
          <Card>
            <p className="text-sm text-slate-600">This ambassador is not on the roster.</p>
          </Card>
        )}
        {account && (
          <>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShiftOpen(true)}>
                Create shift
              </Button>
            </div>
            <BaShiftsCard accountId={account.id} onCreate={() => setShiftOpen(true)} />
          </>
        )}
        <ShiftPlanModal open={shiftOpen} onClose={() => setShiftOpen(false)} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/ho/ambassadors" className="text-sm text-slate-500 hover:text-brand-600">
          ← Ambassadors
        </Link>
        <Button size="sm" onClick={() => setShiftOpen(true)}>
          Create shift
        </Button>
      </div>


      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Profile + readiness + scores */}
        <Card className="h-fit lg:sticky lg:top-4">
          <div className="flex flex-col items-center text-center">
            <Avatar name={ba.name} size="lg" />
            <h2 className="mt-3 text-lg font-bold text-slate-900">{ba.name}</h2>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-sm font-bold text-brand-700">
                {ba.certification}
              </span>
              <StatusBadge status={ba.status} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{ba.city}</p>
            <p className="mt-0.5 text-sm text-slate-600">{ba.store}</p>

            <div className="mt-5">
              <ProgressRing value={ba.readiness} size={120} stroke={9} label="Readiness" />
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <ScoreBars
              rows={[
                { label: 'Product Knowledge', value: ba.scores.product },
                { label: 'Communication', value: ba.scores.communication },
                { label: 'Selling Confidence', value: ba.scores.selling },
                { label: 'Objection Handling', value: ba.scores.objection },
                { label: 'Customer Interaction', value: ba.scores.interaction },
              ]}
            />
          </div>

          <div className="mt-4">
            <Link to="/ba/training" className="block">
              <Button variant="secondary" size="sm" className="w-full">
                Open Training
              </Button>
            </Link>
          </div>
        </Card>

        {/* Main content */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Conv. rate" value={`${ba.today.rate}%`} />
            <MiniStat
              label="Incentive"
              value={incentive ? formatPkr(incentive.totalPkr) : '—'}
            />
          </div>

          <Card>
            <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Lifecycle
            </div>
            <ol className="mt-2 flex gap-1 overflow-x-auto pb-1">
              {allLifecycle.map((stage, i) => {
                const done = ba.lifecycle.includes(stage)
                const current = ba.lifecycle[ba.lifecycle.length - 1] === stage
                return (
                  <li
                    key={stage}
                    className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] sm:text-xs ${
                      current
                        ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-200'
                        : done
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-slate-50 text-slate-400'
                    }`}
                  >
                    {done ? (
                      <Check size={12} className="shrink-0" />
                    ) : (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300" />
                    )}
                    <span className="truncate">
                      {i + 1}. {stage}
                    </span>
                  </li>
                )
              })}
            </ol>
          </Card>

          <BaShiftsCard accountId={ba.id} onCreate={() => setShiftOpen(true)} />

          {incentive && (
            <Card className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50/80">
              <div>
                <div className="text-xs font-semibold text-emerald-800 uppercase">Week incentive</div>
                <div className="text-xl font-black text-emerald-900">{formatPkr(incentive.totalPkr)}</div>
                <div className="text-xs text-emerald-700/80">Rank #{incentive.rank}</div>
              </div>
              <Link to="/ho/incentives">
                <Button size="sm" variant="secondary">
                  View incentives
                </Button>
              </Link>
            </Card>
          )}
        </div>
      </div>

      <ShiftPlanModal open={shiftOpen} onClose={() => setShiftOpen(false)} />
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 text-center shadow-sm">
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}
