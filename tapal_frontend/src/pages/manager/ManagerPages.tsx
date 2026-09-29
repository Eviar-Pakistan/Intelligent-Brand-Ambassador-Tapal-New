import { Link } from 'react-router-dom'
import { stores } from '../../data/mock'
import { Button, Card, PageHeader, StatusBadge, TableScroll } from '../../components/ui'
import { MapPin } from 'lucide-react'
import { useCreatedStores } from '../../lib/storeRegistry'

export function ManagerDashboard() {
  useCreatedStores()
  const store = stores[0]
  return (
    <div className="space-y-5">
      <PageHeader
        title="Store Operations"
        description={
          store
            ? `${store.name} · ${stores.length} stores · live attendance & coverage`
            : 'No stores yet. Create one and it is saved on the server.'
        }
        actions={
          <>
            <Link to="/manager/stores">
              <Button variant="secondary">All Stores</Button>
            </Link>
            <Link to="/manager/stores/new">
              <Button>Create Store</Button>
            </Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="text-xs text-slate-500">Active BAs</div>
          <div className="text-xl font-bold sm:text-2xl">3</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">GPS Online</div>
          <div className="text-2xl font-bold text-emerald-600">2</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Coverage</div>
          <div className="text-2xl font-bold">{store ? `${store.coverage}%` : '—'}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Today Footfall</div>
          <div className="text-2xl font-bold">{store ? store.todayFootfall.toLocaleString() : '—'}</div>
        </Card>
      </div>
      <Card>
        <h3 className="mb-3 font-semibold">Live BA Status</h3>
        <div className="space-y-2">
          {!store && <p className="text-sm text-slate-500">No stores yet.</p>}
          {store?.assigned.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <MapPin size={14} className="text-brand-600" />
                {a.name}
              </div>
              <StatusBadge status={a.state} />
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/manager/attendance" className="text-sm font-semibold text-brand-600">
            Attendance →
          </Link>
          <Link to="/manager/coverage" className="text-sm font-semibold text-brand-600">
            Coverage →
          </Link>
          <Link to="/manager/stores" className="text-sm font-semibold text-brand-600">
            Stores →
          </Link>
          <Link to="/manager/stores/new" className="text-sm font-semibold text-brand-600">
            Create Store →
          </Link>
        </div>
      </Card>
    </div>
  )
}

export function AttendancePage() {
  const rows: { name: string; in: string; gps: string; status: string }[] = []
  return (
    <div>
      <PageHeader title="Attendance" description="Shift check-ins" />
      <Card padding={false}>
        <TableScroll minWidth={560}>
          <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">BA</th>
              <th className="px-4 py-3">Check-in</th>
              <th className="px-4 py-3">GPS</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3">{r.in}</td>
                <td className="px-4 py-3">{r.gps}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className="border-t border-slate-100">
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                  No ambassadors have checked in.
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

export function CoveragePage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Store Coverage" description="Manager live coverage view" />
      <div className="grid gap-4 md:grid-cols-2">
        {stores.map((s) => (
          <Card key={s.id}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">
                  #{s.id} {s.name}
                </div>
                <div className="text-xs text-slate-500">{s.city}</div>
              </div>
              <StatusBadge status={s.status} />
            </div>
            <div className="mt-3 text-sm">
              Coverage <strong>{s.coverage}%</strong> · {s.bas} BAs
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
