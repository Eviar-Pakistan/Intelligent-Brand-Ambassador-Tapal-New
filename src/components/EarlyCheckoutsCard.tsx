import { Card, CardHeader } from './ui'
import { earlyCheckoutsForToday, useEarlyCheckouts } from '../lib/earlyCheckouts'

export function EarlyCheckoutsCard({ storeIds }: { storeIds?: number[] }) {
  const rows = earlyCheckoutsForToday(useEarlyCheckouts(), storeIds)

  return (
    <Card>
      <CardHeader
        title="Early checkouts"
        subtitle={
          storeIds
            ? 'BAs in your stores who left before 8:00 PM'
            : 'BAs who left before the 8:00 PM shift end'
        }
      />
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No early checkouts today.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-100">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="font-semibold text-slate-900">{row.baName}</div>
                <div className="text-xs text-slate-500">
                  {new Date(row.at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </div>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{row.storeName}</div>
              <p className="mt-1 break-words text-sm text-slate-700">{row.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
