import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Card, PageHeader, SearchInput, TableScroll, Tabs } from '../../components/ui'
import { djangoFetch, headOfficeHome, isMisUser, useDjangoUser } from '../../lib/djangoApi'

type AuditRow = {
  id: number
  at: string
  actorEmail: string
  actorName: string
  action: string
  actionLabel: string
  entityType: string
  entityId: string
  summary: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  meta: Record<string, unknown>
  ipAddress: string | null
}

const ACTION_TABS = ['All', 'Daily reports', 'Attendance', 'Ambassadors'] as const
const ACTION_CODES: Record<(typeof ACTION_TABS)[number], string> = {
  All: '',
  'Daily reports': 'daily_report.edit',
  Attendance: 'attendance.edit',
  Ambassadors: 'ambassador.edit',
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rangeFor(preset: string): [string, string] {
  const today = new Date()
  const from = new Date(today)
  if (preset === 'Last 7 days') from.setDate(from.getDate() - 6)
  if (preset === 'This month') from.setDate(1)
  return [isoDay(from), isoDay(today)]
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  })
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  const keys = Object.keys(value || {})
  if (!keys.length) return null
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900/95 p-3 text-[11px] leading-relaxed text-slate-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

/** Standard Head Office: review actions performed by MIS users. */
export function MisAuditLogPage() {
  const user = useDjangoUser()
  const [preset, setPreset] = useState('Last 7 days')
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor('Last 7 days'))
  const [actionTab, setActionTab] = useState<(typeof ACTION_TABS)[number]>('All')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const action = ACTION_CODES[actionTab]

  useEffect(() => {
    if (!user || isMisUser(user)) return
    let cancelled = false
    setRows(null)
    const params = new URLSearchParams({ date_from: from, date_to: to, limit: '300' })
    if (action) params.set('action', action)
    if (query.trim()) params.set('q', query.trim())
    void djangoFetch(`/api/mis-audit-logs/?${params}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { results?: AuditRow[]; detail?: string }
        if (cancelled) return
        if (!res.ok) {
          setError(data.detail || 'Could not load the audit log.')
          setRows([])
          return
        }
        setError(null)
        setRows(data.results ?? [])
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load the audit log.')
          setRows([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [user, from, to, action, query])

  const shown = useMemo(() => rows ?? [], [rows])

  if (user && isMisUser(user)) {
    return <Navigate to={headOfficeHome(user)} replace />
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="MIS audit log"
        description="Actions performed by MIS Head Office users — report edits, attendance changes, and ambassador updates."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Tabs
            tabs={['Today', 'Last 7 days', 'This month']}
            value={preset}
            onChange={(next) => {
              setPreset(next)
              setRange(rangeFor(next))
            }}
          />
          <label className="text-xs text-slate-500">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setPreset('')
                setRange([e.target.value, to])
              }}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            />
          </label>
          <label className="text-xs text-slate-500">
            To
            <input
              type="date"
              value={to}
              min={from}
              max={isoDay(new Date())}
              onChange={(e) => {
                setPreset('')
                setRange([from, e.target.value])
              }}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            />
          </label>
          <SearchInput placeholder="Search MIS user, summary…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="mt-3">
          <Tabs
            tabs={[...ACTION_TABS]}
            value={actionTab}
            onChange={(next) => setActionTab(next as (typeof ACTION_TABS)[number])}
          />
        </div>
      </Card>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card>
        <TableScroll>
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">MIS user</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Summary</th>
                <th className="px-3 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    No MIS actions in this range.
                  </td>
                </tr>
              ) : (
                shown.map((row) => {
                  const open = openId === row.id
                  return (
                    <tr key={row.id} className="border-b border-slate-50 align-top">
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{when(row.at)}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-900">{row.actorName || '—'}</div>
                        <div className="text-xs text-slate-500">{row.actorEmail}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {row.actionLabel || row.action}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        <div>{row.summary || '—'}</div>
                        {open && (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <JsonBlock label="Before" value={row.before} />
                            <JsonBlock label="After" value={row.after} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : row.id)}
                          className="text-xs font-semibold text-brand-700 hover:underline"
                        >
                          {open ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  )
}
