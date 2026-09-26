import { Link, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ambassadors, baShiftHistory, scheduleDays, stores, type LifecycleStage } from '../../data/mock'
import {
  Avatar,
  Button,
  Card,
  Modal,
  PageHeader,
  ProgressRing,
  ScoreBars,
  SearchInput,
  Select,
  StatusBadge,
  TableScroll,
  Tabs,
} from '../../components/ui'
import { Check, Copy, Download, ExternalLink, FileSpreadsheet, Upload, UserPlus } from 'lucide-react'
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
import { buildIncentiveRoster, formatPkr } from '../../lib/incentives'
import { shiftLabelFromTimes, useSchedule } from '../../context/ScheduleContext'
import {
  currentMonthKey,
  downloadTargetTemplate,
  parseTargetFile,
  setBaMonthTarget,
  setBaMonthTargets,
  targetForBa,
  useBaTargets,
  type TargetParseResult,
  type TargetPerson,
} from '../../lib/baTargets'

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

const allLifecycle: LifecycleStage[] = [
  'Recruited',
  'AI Screened',
  'Certified',
  'Trained',
  'Deployed',
  'Live'
]

const timeFieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500'

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
  return (
    <Modal open={!!account} onClose={onClose} title={title}>
      {account && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Share this link with {account.name}. Opening it takes them straight into their account. There is no
            password.
          </p>
          <AccountLinkPanel account={account} />
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

  function close() {
    setForm(fresh())
    setError(null)
    onClose()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Name is required.')
    if (!validEmail(form.email)) return setError('Enter a valid email.')
    if (baEmailInUse(form.email)) return setError('Another ambassador already uses this email.')
    const account = createBaAccount(form)
    onCreated(account)
    close()
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
          <span className="mb-1 block font-medium text-slate-700">Email *</span>
          <input type="email" value={form.email} onChange={set('email')} className={modalFieldClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Phone</span>
          <input type="tel" value={form.phone} onChange={set('phone')} className={modalFieldClass} />
        </label>
        <p className="text-xs text-slate-500">
          After you create the ambassador, you get a personal link. They open that link to enter their account.
        </p>
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          <Button type="submit">Create ambassador</Button>
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
            Fill in one ambassador per row. Name and Email are required; the Instructions sheet explains the rest.
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
                onClick={() => {
                  const created = createBaAccounts(result.rows.map((r) => r.input))
                  close()
                  onCreated(created)
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
              {[account.city, account.email, account.phone].filter(Boolean).join(' · ') || 'No contact details'}
            </span>
          </div>

          {account.result ? (
            <AssessmentReport name={account.name} result={account.result} answers={account.answers} />
          ) : (
            <p className="text-slate-600">
              {account.videoWatched
                ? `Training video watched · ${account.answers.length} assessment answer${account.answers.length === 1 ? '' : 's'} submitted so far.`
                : 'Has not finished the training video yet.'}
            </p>
          )}

          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Account link</div>
            <AccountLinkPanel account={account} />
          </div>
        </div>
      )}
    </Modal>
  )
}

export function AmbassadorsPage() {
  const [tab, setTab] = useState('All')
  const [q, setQ] = useState('')
  const accounts = useBaAccounts()
  const [createOpen, setCreateOpen] = useState(false)
  const [linkPrompt, setLinkPrompt] = useState<{ account: BaAccount; title: string } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkCreated, setBulkCreated] = useState<BaAccount[] | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetBulkOpen, setTargetBulkOpen] = useState(false)

  const filtered = ambassadors.filter((a) => {
    const matchTab = tab === 'All' || a.status === tab
    const matchQ = a.name.toLowerCase().includes(q.toLowerCase())
    return matchTab && matchQ
  })
  const filteredAccounts = accounts.filter((a) => {
    if (isDemoBa(a.id)) return false
    const matchTab = tab === 'All' || (a.status === 'Invited' ? tab === 'Pending' : a.status === tab)
    return matchTab && a.name.toLowerCase().includes(q.toLowerCase())
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
              Set target & sales
            </Button>
            <Button variant="secondary" onClick={() => setTargetBulkOpen(true)}>
              <FileSpreadsheet size={15} /> Upload targets
            </Button>
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              <FileSpreadsheet size={15} /> Bulk upload (Excel)
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
              <th className="px-4 py-3">BA</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Check-in</th>
              <th className="px-4 py-3">Check-out</th>
              <th className="px-4 py-3">Data filled</th>
              <th className="px-4 py-3">Open link</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setDetailId(a.id)} className="flex items-center gap-3 text-left">
                    <Avatar name={a.name} />
                    <span className="font-medium text-slate-900 hover:text-brand-600">{a.name}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.city || '—'}</td>
                <td className="px-4 py-3 font-semibold">{a.result ? `${a.result.quality}%` : '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-3 text-slate-600">—</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">—</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">—</td>
                <td className="px-4 py-3">
                  <StatusBadge status="Pending" />
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
            {filtered.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3">
                  <Link to={`/ho/ambassadors/${a.id}`} className="flex items-center gap-3">
                    <Avatar name={a.name} />
                    <span className="font-medium text-slate-900 hover:text-brand-600">{a.name}</span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.city}</td>
                <td className="px-4 py-3 font-semibold">{a.score}%</td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-3 text-slate-600">{a.store}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{a.checkIn}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{a.checkOut}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.dataFilled} />
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const account = accounts.find((acc) => acc.id === a.id)
                      if (!account) return
                      setLinkPrompt({ account, title: `${a.name} · account link` })
                    }}
                  >
                    <ExternalLink size={13} /> Open link
                  </Button>
                </td>
              </tr>
            ))}
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
              {bulkCreated.length} {bulkCreated.length === 1 ? 'ambassador' : 'ambassadors'} created. Share each
              account link — opening it enters that ambassador&apos;s account.
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
                    bulkCreated.map((a) => ({ name: a.name, email: a.email, url: baAccessUrl(a) })),
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

function targetPeople(accounts: { id: string; name: string }[]): TargetPerson[] {
  const map = new Map<string, string>()
  for (const ambassador of ambassadors) map.set(ambassador.id, ambassador.name)
  for (const account of accounts) {
    if (!map.has(account.id)) map.set(account.id, account.name)
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }))
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

  function close() {
    setResult(null)
    setFileName('')
    setSaved(0)
    onClose()
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setSaved(0)
    setFileName(file.name)
    setResult(await parseTargetFile(file, people))
    setBusy(false)
  }

  return (
    <Modal open={open} onClose={close} title="Upload targets from Excel">
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <div className="font-semibold text-slate-900">1. Download the template</div>
          <p className="text-xs text-slate-500">
            The file lists every ambassador for this month. Enter Target Kg, then save the file. The Instructions sheet
            explains Month and Sales Kg.
          </p>
          <Button variant="secondary" onClick={() => void downloadTargetTemplate(people)}>
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
                onClick={() => {
                  setBaMonthTargets(result.rows)
                  setSaved(result.rows.length)
                  setResult(null)
                }}
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
  const [targetKg, setTargetKg] = useState('')
  const [salesKg, setSalesKg] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    const row = targetForBa(baId, month, targets)
    setTargetKg(row ? String(row.targetKg) : '')
    setSalesKg(row ? String(row.salesKg) : '')
  }, [open, baId, month, targets])

  function save() {
    const person = people.find((item) => item.id === baId)
    const target = Number(targetKg)
    const sales = Number(salesKg)
    if (!person || !Number.isFinite(target) || target < 0 || !Number.isFinite(sales) || sales < 0) return
    setBaMonthTarget({
      baId: person.id,
      baName: person.name,
      month,
      targetKg: target,
      salesKg: sales,
    })
    setSaved(true)
  }

  return (
    <Modal open={open} onClose={onClose} title="Set target and sales">
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
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Target (Kg)</span>
          <input
            type="number"
            min={0}
            value={targetKg}
            onChange={(e) => setTargetKg(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Sales (Kg)</span>
          <input
            type="number"
            min={0}
            value={salesKg}
            onChange={(e) => setSalesKg(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        {saved && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Saved for this ambassador and month.
          </p>
        )}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          <Button onClick={save} disabled={targetKg === '' || salesKg === ''}>
            Save
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
  const ba = ambassadors.find((a) => a.id === id) ?? ambassadors[0]
  const { schedule, addShift } = useSchedule()
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shiftTab, setShiftTab] = useState('Current shifts')
  const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState({
    day: scheduleDays[0].key,
    start: '10:00',
    end: '14:00',
    storeId: String(stores[0].id),
  })
  const incentive = buildIncentiveRoster().find((r) => r.baId === ba.id)

  const currentShifts = useMemo(() => {
    const dayOrder = scheduleDays.map((d) => d.key)
    return schedule
      .filter((s) => s.baId === ba.id)
      .slice()
      .sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day))
  }, [schedule, ba.id])

  const historyShifts = useMemo(
    () => baShiftHistory.filter((s) => s.baId === ba.id),
    [ba.id],
  )

  function createShift() {
    if (form.start >= form.end) {
      setToast('End time must be after start time')
      setTimeout(() => setToast(null), 3000)
      return
    }
    const store = stores.find((s) => String(s.id) === form.storeId)
    const dayInfo = scheduleDays.find((d) => d.key === form.day)
    if (!store || !dayInfo) return

    addShift({
      day: form.day,
      date: dayInfo.date,
      storeId: store.id,
      storeName: store.name,
      city: store.city,
      shift: shiftLabelFromTimes(form.start, form.end),
      peakRecommended: false,
      baId: ba.id,
      baName: ba.name,
      status: 'Scheduled',
    })
    setShiftOpen(false)
    setToast(`Shift created for ${ba.name} · ${store.name}`)
    setTimeout(() => setToast(null), 3000)
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

      {toast && (
        <div className="animate-fade-up rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      )}

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

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Tabs
                tabs={['Current shifts', 'Shift history']}
                value={shiftTab}
                onChange={setShiftTab}
              />
              <span className="text-xs text-slate-400">
                {shiftTab === 'Current shifts'
                  ? `${currentShifts.length} this week`
                  : `${historyShifts.length} past`}
              </span>
            </div>

            {shiftTab === 'Current shifts' ? (
              currentShifts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
                  <p className="text-sm text-slate-500">No shifts this week</p>
                  <Button size="sm" className="mt-3" onClick={() => setShiftOpen(true)}>
                    Create shift
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {currentShifts.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">
                          {s.day} · {s.date}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          #{s.storeId} {s.storeName} · {s.city}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-800">{s.shift}</span>
                        <StatusBadge status="Scheduled" />
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : historyShifts.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No past shifts on record.</p>
            ) : (
              <TableScroll minWidth={520}>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Date</th>
                      <th className="pb-2 pr-3 font-medium">Store</th>
                      <th className="pb-2 pr-3 font-medium">Shift</th>
                      <th className="pb-2 pr-3 font-medium">In / Out</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyShifts.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{s.day}</div>
                          <div className="text-xs text-slate-400">{s.date}</div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="max-w-[140px] truncate">
                            #{s.storeId} {s.storeName}
                          </div>
                          <div className="text-xs text-slate-400">{s.city}</div>
                        </td>
                        <td className="py-2.5 pr-3 font-medium whitespace-nowrap">{s.shift}</td>
                        <td className="py-2.5 pr-3 tabular-nums text-slate-600 whitespace-nowrap">
                          {s.checkIn} → {s.checkOut}
                        </td>
                        <td className="py-2.5">
                          <StatusBadge status={s.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>

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

      <Modal open={shiftOpen} onClose={() => setShiftOpen(false)} title={`Create shift · ${ba.name}`}>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Day</span>
            <Select
              className="w-full"
              value={form.day}
              onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
            >
              {scheduleDays.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} · {d.date}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Start time</span>
              <input
                type="time"
                className={timeFieldClass}
                value={form.start}
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">End time</span>
              <input
                type="time"
                className={timeFieldClass}
                value={form.end}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Store</span>
            <Select
              className="w-full"
              value={form.storeId}
              onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} {s.name} ({s.city})
                </option>
              ))}
            </Select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShiftOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createShift}>Save shift</Button>
          </div>
        </div>
      </Modal>
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
