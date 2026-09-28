import { useEffect, useState } from 'react'
import { Button, Card, StatusBadge, TableScroll, Tabs } from '../../components/ui'
import { serverAmbassadorId, type MonthlyShift } from '../../context/ScheduleContext'
import { djangoFetch, djangoToken } from '../../lib/djangoApi'
import { timeOf, useAttendance } from './BaAttendancePage'

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function getJson<T>(path: string): Promise<T> {
  const response = await djangoFetch(path)
  if (!response.ok) throw new Error()
  return (await response.json()) as T
}

/** An ambassador's monthly shifts (this month onward) and attendance for the last 30 days. */
export function BaShiftsCard({ accountId, onCreate }: { accountId: string; onCreate: () => void }) {
  const serverId = serverAmbassadorId(accountId)
  const [tab, setTab] = useState('Monthly shifts')
  const [shifts, setShifts] = useState<MonthlyShift[]>([])
  const [error, setError] = useState<string | null>(null)
  const [[since, until]] = useState(() => {
    const today = new Date()
    const from = new Date(today)
    from.setDate(from.getDate() - 30)
    return [isoDay(from), isoDay(today)]
  })
  const { data: attendanceData, error: attendanceError } = useAttendance(since, until, serverId)
  const attendance = attendanceData?.results ?? []

  useEffect(() => {
    if (serverId === null || !djangoToken()) return
    let cancelled = false
    const thisMonth = isoDay(new Date()).slice(0, 7)
    getJson<{ results: MonthlyShift[] }>(`/api/shifts/?ambassador=${serverId}&from_month=${thisMonth}`)
      .then((monthly) => {
        if (cancelled) return
        setShifts([...monthly.results].sort((a, b) => a.month.localeCompare(b.month)))
        setError(null)
      })
      .catch(() => !cancelled && setError('Shifts could not be loaded.'))
    return () => {
      cancelled = true
    }
  }, [serverId])

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={['Monthly shifts', 'Attendance']} value={tab} onChange={setTab} />
        <span className="text-xs text-slate-400">
          {tab === 'Monthly shifts' ? `${shifts.length} from this month` : `${attendance.length} days in the last 30`}
        </span>
      </div>

      {tab === 'Monthly shifts' && error ? (
        <p className="py-6 text-center text-sm text-rose-700">{error}</p>
      ) : tab === 'Attendance' && attendanceError ? (
        <p className="py-6 text-center text-sm text-rose-700">{attendanceError}</p>
      ) : tab === 'Monthly shifts' ? (
        shifts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
            <p className="text-sm text-slate-500">No shifts this month or later</p>
            <Button size="sm" className="mt-3" onClick={onCreate}>
              Create shift
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {shifts.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{s.monthLabel}</div>
                  <div className="truncate text-xs text-slate-500">
                    {[s.storeCode, s.storeName, s.city].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{s.shift}</span>
                  <StatusBadge status={s.status} />
                </div>
              </div>
            ))}
          </div>
        )
      ) : attendance.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No attendance in the last 30 days.</p>
      ) : (
        <TableScroll minWidth={520}>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500 uppercase">
              <tr>
                <th className="pb-2 pr-3 font-medium">Day</th>
                <th className="pb-2 pr-3 font-medium">Store</th>
                <th className="pb-2 pr-3 font-medium">Shift</th>
                <th className="pb-2 pr-3 font-medium">In / Out</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">{s.day}</div>
                    <div className="text-xs text-slate-400">{s.date}</div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="max-w-[140px] truncate">{s.storeName}</div>
                    <div className="text-xs text-slate-400">{s.city}</div>
                  </td>
                  <td className="py-2.5 pr-3 font-medium whitespace-nowrap">{s.shift}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-slate-600 whitespace-nowrap">
                    {timeOf(s.checkedInAt)} → {timeOf(s.checkedOutAt)}
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
  )
}
