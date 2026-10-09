import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import { EarlyCheckoutsCard } from '../../components/EarlyCheckoutsCard'
import { Button, Card, PageHeader, SearchInput, StatusBadge, TableScroll, Tabs } from '../../components/ui'
import { portalFetch } from '../../lib/serverApi'

export type AttendanceStatus = 'Present' | 'On shift' | 'Not checked in' | 'Absent'

export type AttendanceRow = {
  id: string
  date: string
  day: string
  baId: number
  baName: string
  baCode: string
  coveredByName?: string | null
  coverageOfName?: string | null
  reportOwnerName?: string | null
  coverageAssignedByName?: string | null
  coverageAssignedAt?: string | null
  coverageCancelled?: boolean
  storeId: number
  storeName: string
  storeCode: string
  city: string
  shift: string
  checkedInAt: string | null
  attendanceType?: 'store' | 'training' | string | null
  checkedOutAt: string | null
  checkInLat?: number | null
  checkInLng?: number | null
  checkInAccuracy?: number | null
  checkInPhoto?: string | null
  checkOutLat?: number | null
  checkOutLng?: number | null
  checkOutAccuracy?: number | null
  reportSubmittedAt: string | null
  earlyCheckoutReason: string | null
  status: AttendanceStatus
}

type AttendanceResponse = {
  date_from: string
  date_to: string
  summary: { present: number; on_shift: number; not_checked_in: number; absent: number; early_checkouts: number; total: number }
  results: AttendanceRow[]
}

const REFRESH_MS = 60_000
const STATUS_TABS = ['All', 'Present', 'On shift', 'Not checked in', 'Absent'] as const

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function presetRange(preset: string): [string, string] {
  const today = new Date()
  const from = new Date(today)
  if (preset === 'Yesterday') {
    from.setDate(from.getDate() - 1)
    return [isoDay(from), isoDay(from)]
  }
  if (preset === 'Last 7 days') from.setDate(from.getDate() - 6)
  if (preset === 'This month') from.setDate(1)
  return [isoDay(from), isoDay(today)]
}

/** "📍 View on map" under a check-in / check-out time, when the phone sent its location. */
function MapLink({ lat, lng, accuracy }: { lat?: number | null; lng?: number | null; accuracy?: number | null }) {
  if (lat == null || lng == null) return null
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-0.5 block text-[11px] font-semibold text-brand-600 hover:underline"
      title={`${lat.toFixed(5)}, ${lng.toFixed(5)}${accuracy != null ? ` · ±${Math.round(accuracy)} m` : ''}`}
    >
      📍 View on map
    </a>
  )
}

export function timeOf(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' })
}

function dateLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Load /api/attendance/ for a date range. Refreshes every minute.
 * `ambassadorId` undefined = every BA; null = a BA with no server record (nothing to load).
 */
export function useAttendance(dateFrom: string, dateTo: string, ambassadorId?: number | null) {
  const [data, setData] = useState<AttendanceResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (ambassadorId === null) return
    let cancelled = false
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
    if (ambassadorId) params.set('ambassador', String(ambassadorId))
    const load = () => {
      setLoading(true)
      // Head Office (JWT) or a supervisor (their stores only) — the server scopes the rows.
      return portalFetch(`/api/attendance/?${params}`)
        .then(async (response) => {
          if (!response) {
            if (!cancelled) setError('Sign in to see attendance.')
            return
          }
          if (!response.ok) throw new Error()
          const next = (await response.json()) as AttendanceResponse
          if (!cancelled) {
            setData(next)
            setError(null)
          }
        })
        .catch(() => !cancelled && setError('Attendance could not be loaded. Check that the server is running.'))
        .finally(() => !cancelled && setLoading(false))
    }
    void load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [dateFrom, dateTo, ambassadorId, reloadTick])

  return { data, error, loading, reload: () => setReloadTick((n) => n + 1) }
}

async function downloadAttendance(rows: AttendanceRow[], from: string, to: string) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      'Date', 'BA code', 'BA name', 'Store code', 'Store', 'City',
      'Coverage details',
      'Check-in', 'Check-in latitude', 'Check-in longitude',
      'Check-out', 'Check-out latitude', 'Check-out longitude',
      'Report submitted', 'Status', 'Early checkout reason',
    ],
    ...rows.map((r) => [
      r.date,
      r.baCode,
      r.baName,
      r.storeCode,
      r.storeName,
      r.city,
      r.coverageCancelled && r.coverageOfName
        ? `Coverage cancelled for ${r.coverageOfName}`
        : r.coveredByName
        ? `Absent; covered by ${r.coveredByName} at ${r.storeName}`
        : r.coverageOfName
          ? `Covering ${r.coverageOfName} at ${r.storeName}; report credit to ${r.reportOwnerName || r.coverageOfName}`
          : '',
      timeOf(r.checkedInAt),
      r.checkInLat ?? '',
      r.checkInLng ?? '',
      timeOf(r.checkedOutAt),
      r.checkOutLat ?? '',
      r.checkOutLng ?? '',
      r.reportSubmittedAt ? timeOf(r.reportSubmittedAt) : 'No',
      r.status,
      r.earlyCheckoutReason ?? '',
    ]),
  ])
  sheet['!cols'] = [12, 12, 22, 12, 24, 12, 55, 10, 12, 12, 10, 12, 12, 14, 14, 36].map((wch) => ({ wch }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Attendance')
  XLSX.writeFile(book, `BA_Attendance_${from}_to_${to}.xlsx`)
}

/** Head Office sees every BA; a supervisor (storeIds given) sees the BAs at their own stores. */
export function BaAttendancePage({ storeIds }: { storeIds?: number[] } = {}) {
  const supervisorView = storeIds !== undefined
  const [preset, setPreset] = useState('Today')
  const [[dateFrom, dateTo], setRange] = useState<[string, string]>(() => presetRange('Today'))
  const [status, setStatus] = useState<string>('All')
  const [query, setQuery] = useState('')
  const { data, error, loading } = useAttendance(dateFrom, dateTo)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.results ?? []).filter(
      (r) =>
        (status === 'All' || r.status === status) &&
        (!q || [r.baName, r.baCode, r.storeName, r.storeCode, r.city].some((v) => (v ?? '').toLowerCase().includes(q))),
    )
  }, [data, status, query])

  const summary = data?.summary
  const cards = [
    { label: 'Present', value: summary?.present, tone: 'text-emerald-600', hint: 'Report submitted & checked out' },
    { label: 'On shift', value: summary?.on_shift, tone: 'text-sky-600', hint: 'Checked in, report pending' },
    { label: 'Not checked in', value: summary?.not_checked_in, tone: 'text-amber-600', hint: 'Scheduled today' },
    { label: 'Absent', value: summary?.absent, tone: 'text-rose-600', hint: 'No completed check-out' },
  ]

  const download = (
    <Button variant="secondary" disabled={rows.length === 0} onClick={() => void downloadAttendance(rows, dateFrom, dateTo)}>
      <Download size={15} /> Download
    </Button>
  )

  return (
    <div className="space-y-5">
      {supervisorView ? (
        // The supervisor portal shows its own page header.
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            A BA is Present only after checking in, submitting the checkout report and checking out
          </p>
          {download}
        </div>
      ) : (
        <PageHeader
          title="BA Attendance"
          description="A BA is Present only after checking in, submitting the checkout report and checking out"
          actions={download}
        />
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Tabs
            tabs={['Today', 'Yesterday', 'Last 7 days', 'This month']}
            value={preset}
            onChange={(next) => {
              setPreset(next)
              setRange(presetRange(next))
            }}
          />
          <label className="text-xs text-slate-500">
            From
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => {
                setPreset('')
                setRange([e.target.value, dateTo])
              }}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            />
          </label>
          <label className="text-xs text-slate-500">
            To
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={isoDay(new Date())}
              onChange={(e) => {
                setPreset('')
                setRange([dateFrom, e.target.value])
              }}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            />
          </label>
          {loading && <span className="text-xs text-slate-400">Refreshing…</span>}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className={`text-2xl font-bold ${c.tone}`}>{c.value ?? '—'}</div>
            <div className="text-[11px] text-slate-400">{c.hint}</div>
          </Card>
        ))}
      </div>

      <EarlyCheckoutsCard storeIds={storeIds} />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search BA, code or store..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <Tabs tabs={[...STATUS_TABS]} value={status} onChange={setStatus} />
        {summary && summary.early_checkouts > 0 && (
          <span className="text-xs font-medium text-amber-700">{summary.early_checkouts} early check-outs</span>
        )}
      </div>

      <Card padding={false}>
        {error ? (
          <p className="px-4 py-6 text-sm text-rose-700">{error}</p>
        ) : (
          <>
          <ul className="divide-y divide-slate-100 sm:hidden">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    {r.checkInPhoto && (
                      <a href={r.checkInPhoto} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        <img
                          src={r.checkInPhoto}
                          alt={`${r.baName} at check-in`}
                          className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200"
                        />
                      </a>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{r.baName}</div>
                      <div className="truncate text-xs text-slate-500">
                        {r.storeName}
                        {r.city ? ` · ${r.city}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {dateLabel(r.date)} · {r.day}
                      </div>
                      {r.coveredByName && (
                        <div className="mt-1 text-xs font-medium text-amber-700">Absent · covered by {r.coveredByName}</div>
                      )}
                      {r.coverageOfName && (
                        <div className="mt-1 text-xs font-medium text-violet-700">
                          {r.coverageCancelled
                            ? `Planned cover cancelled for ${r.coverageOfName}`
                            : `Covering ${r.coverageOfName}; report credit to ${r.reportOwnerName || r.coverageOfName}`}
                        </div>
                      )}
                      {r.coveredByName && r.coverageAssignedByName && (
                        <div className="mt-1 text-[11px] text-slate-400">
                          Cover assigned by {r.coverageAssignedByName}
                          {r.coverageAssignedAt ? ` · ${new Date(r.coverageAssignedAt).toLocaleString()}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                    <div className="text-[10px] text-slate-500">Check-in</div>
                    <div className="font-semibold tabular-nums">{timeOf(r.checkedInAt)}</div>
                    <MapLink lat={r.checkInLat} lng={r.checkInLng} accuracy={r.checkInAccuracy} />
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                    <div className="text-[10px] text-slate-500">Check-out</div>
                    <div className="font-semibold tabular-nums">{timeOf(r.checkedOutAt)}</div>
                    <MapLink lat={r.checkOutLat} lng={r.checkOutLng} accuracy={r.checkOutAccuracy} />
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                    <div className="text-[10px] text-slate-500">Report</div>
                    <div
                      className={
                        r.reportSubmittedAt
                          ? r.attendanceType === 'training'
                            ? 'font-semibold text-violet-700'
                            : 'font-semibold text-emerald-700'
                          : 'text-slate-400'
                      }
                    >
                      {r.reportSubmittedAt
                        ? r.attendanceType === 'training'
                          ? 'On training'
                          : 'Submitted'
                        : 'Not yet'}
                    </div>
                  </div>
                </div>
                {r.earlyCheckoutReason && (
                  <p className="mt-2 text-[11px] text-amber-700">Early: {r.earlyCheckoutReason}</p>
                )}
              </li>
            ))}
            {(!data || rows.length === 0) && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                {!data
                  ? 'Loading attendance…'
                  : data.results.length === 0
                    ? 'No BAs have shifts in this period.'
                    : 'No attendance matches these filters.'}
              </li>
            )}
          </ul>
          <TableScroll minWidth={780} className="hidden sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Ambassador</th>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Coverage details</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Check-out</th>
                  <th className="px-4 py-3">Report</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium">{dateLabel(r.date)}</div>
                      <div className="text-xs text-slate-400">{r.day}</div>
                    </td>
                    <td className="px-4 py-3">
                      {supervisorView ? (
                        <span className="font-medium">{r.baName}</span>
                      ) : (
                        <Link to={`/ho/ambassadors/api-${r.baId}`} className="font-medium hover:text-brand-600">
                          {r.baName}
                        </Link>
                      )}
                      <div className="font-mono text-xs text-slate-400">{r.baCode}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{r.storeName}</div>
                      <div className="text-xs text-slate-400">{[r.storeCode, r.city].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.coveredByName ? (
                        <div className="max-w-[16rem] text-xs font-medium text-amber-700">
                          {r.baName} absent · covered by {r.coveredByName} at {r.storeName}
                        </div>
                      ) : r.coverageOfName ? (
                        <div className="max-w-[16rem] text-xs font-medium text-violet-700">
                          {r.coverageCancelled ? (
                            `Planned cover cancelled for ${r.coverageOfName}`
                          ) : (
                            <>
                              Covering for {r.coverageOfName} at {r.storeName}
                              <div className="mt-0.5 font-normal text-slate-500">
                                Report and target credit: {r.reportOwnerName || r.coverageOfName}
                              </div>
                            </>
                          )}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                      {timeOf(r.checkedInAt)}
                      <MapLink lat={r.checkInLat} lng={r.checkInLng} accuracy={r.checkInAccuracy} />
                      {r.checkInPhoto && (
                        <a href={r.checkInPhoto} target="_blank" rel="noopener noreferrer" title="Check-in selfie">
                          <img
                            src={r.checkInPhoto}
                            alt={`${r.baName} at check-in`}
                            className="mt-1 h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200"
                          />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                      {timeOf(r.checkedOutAt)}
                      <MapLink lat={r.checkOutLat} lng={r.checkOutLng} accuracy={r.checkOutAccuracy} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.reportSubmittedAt ? (
                        r.attendanceType === 'training' ? (
                          <span className="text-violet-700">On training</span>
                        ) : (
                          <span className="text-emerald-700">Submitted</span>
                        )
                      ) : (
                        <span className="text-slate-400">Not submitted</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                      {r.earlyCheckoutReason && (
                        <div className="mt-1 max-w-[14rem] text-[11px] text-amber-700">
                          Early: {r.earlyCheckoutReason}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {data && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      {data.results.length === 0
                        ? 'No BAs have shifts in this period.'
                        : 'No attendance matches these filters.'}
                    </td>
                  </tr>
                )}
                {!data && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      Loading attendance…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
          </>
        )}
      </Card>
    </div>
  )
}
