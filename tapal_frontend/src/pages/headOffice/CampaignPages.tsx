import { Link } from 'react-router-dom'
import { campaign, campaigns, cities } from '../../data/mock'
import { useDemo } from '../../context/AppContext'
import { Button, Card, PageHeader, ProgressBar, StatusBadge, TableScroll } from '../../components/ui'

export function CampaignsPage() {
  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Multi-campaign platform — Tapal Tea is the active demo campaign"
        actions={<Button>+ New Campaign</Button>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {campaigns.map((c) => (
          <Link
            key={c.id}
            to={c.id === 'tapal-tea' ? '/ho/campaigns/tapal-tea' : '#'}
            className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <StatusBadge status={c.status} />
            <h3 className="mt-3 text-lg font-semibold text-slate-900">{c.name}</h3>
            <p className="text-sm text-slate-500">{c.brand}</p>
            <p className="mt-2 text-xs text-slate-400">
              {c.start} — {c.end}
            </p>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Progress</span>
                <span>{c.progress}%</span>
              </div>
              <ProgressBar value={c.progress} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function CampaignOverviewPage() {
  const demo = useDemo()

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <StatusBadge status={campaign.status} />
            <h2 className="mt-3 text-xl font-bold text-slate-900 sm:text-2xl">{campaign.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Duration: {campaign.start} — {campaign.end}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary">Campaign Settings</Button>
            <Button variant="secondary">Manage Team</Button>
            <Link to="/ho/reports">
              <Button>View Report</Button>
            </Link>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Shoppers" value={demo.shoppers.toLocaleString()} />
        <Metric label="Engagement" value={`${demo.engagement}%`} />
        <Metric label="Conversion" value={`${demo.conversion}%`} />
        <Metric label="Stores" value={String(demo.stores)} />
      </div>

      <Card>
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-semibold text-slate-900">Campaign Progress</span>
          <span className="text-slate-500">{campaign.progress}%</span>
        </div>
        <ProgressBar value={campaign.progress} color="bg-emerald-500" />
      </Card>

      <Card>
        <h3 className="mb-4 font-semibold text-slate-900">Cities</h3>
        <TableScroll>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Stores</th>
                <th className="px-4 py-3">Shoppers</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((c) => (
                <tr key={c.city} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{c.city}</td>
                  <td className="px-4 py-3">{c.stores} Stores</td>
                  <td className="px-4 py-3">{c.shoppers.toLocaleString()} shoppers</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </Card>
  )
}
