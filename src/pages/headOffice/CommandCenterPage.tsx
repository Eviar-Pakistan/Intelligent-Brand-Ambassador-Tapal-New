import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  aiRecommendations,
  baRanking,
  consumerInsights,
  engagementSeries,
  faqs,
  mapPins,
  operations,
  shopperIntel,
  storeRanking,
} from '../../data/mock'
import { useDemo } from '../../context/AppContext'
import { Button, Card, CardHeader, KpiCard, ProgressBar, StatusBadge } from '../../components/ui'
import {
  downloadReportExtract,
  labeledSales,
  labeledStock,
  useDailyReports,
  type ExtractKind,
} from '../../lib/baReport'
import { Download, MapPin, Sparkles, Zap } from 'lucide-react'

export function CommandCenterPage() {
  const demo = useDemo()

  return (
    <div className="space-y-5">
      {demo.sessionComplete && (
        <div className="animate-fade-up rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Connected demo update: shopper session synced — consumers +1, conversion nudged, AI
          optimization refreshed.
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Performance overview</h2>
        <p className="text-sm text-slate-500">Tapal Tea · live Retail Command Center</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Shoppers Engaged" value={demo.shoppers.toLocaleString()} delta="+1 live sync" />
        <KpiCard label="Active Stores" value={demo.stores} delta="38 BAs GPS online" />
        <KpiCard label="Engagement Rate" value={`${demo.engagement}%`} delta="+2.1 pts WoW" />
        <KpiCard label="Conversion Rate" value={`${demo.conversion}%`} delta="+0.8 pts WoW" />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Engagement Trend" subtitle="Last 7 days" />
          <div className="h-52 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={engagementSeries}>
                <defs>
                  <linearGradient id="eng" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Area type="monotone" dataKey="engagement" stroke="#dc2626" fill="url(#eng)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Live Store Map" subtitle="Performance pins" />
          <div className="relative h-52 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 via-brand-50 to-slate-200 sm:h-64">
            <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(#94a3b8_1px,transparent_1px),linear-gradient(90deg,#94a3b8_1px,transparent_1px)] [background-size:36px_36px]" />
            {mapPins.map((pin) => (
              <div
                key={pin.label}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                title={pin.label}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-white shadow-lg ${
                    pin.level === 'high' ? 'bg-success' : pin.level === 'medium' ? 'bg-warning' : 'bg-danger'
                  }`}
                >
                  <MapPin size={14} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-3 text-[11px] text-slate-500">
            <span>● High</span>
            <span>● Medium</span>
            <span>● Low</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-4">
        <Card>
          <CardHeader title="Consumer Insights" />
          <MiniBars rows={consumerInsights.preferredTea.map((x) => ({ label: x.name, value: x.value }))} />
          <div className="mt-3 text-[11px] text-slate-400">Preferred tea · cups/day · price · taste</div>
          <Link to="/ho/consumers" className="mt-3 inline-block text-xs font-semibold text-brand-600">
            Open full intelligence →
          </Link>
        </Card>

        <Card>
          <CardHeader title="Shopper Intelligence" />
          <StatRow label="Footfall" value={shopperIntel.footfall} />
          <StatRow label="Engagement" value={shopperIntel.engagementRate} />
          <StatRow label="Purchase intent" value={shopperIntel.purchaseIntent} />
          <StatRow label="Conversion" value={shopperIntel.conversionRate} />
        </Card>

        <Card>
          <CardHeader title="Operations" />
          <StatRow label="Active BAs" value={String(operations.activeBas)} />
          <StatRow label="GPS online" value={String(operations.gpsOnline)} />
          <StatRow label="Attendance" value={operations.attendance} />
          <StatRow label="Store coverage" value={operations.storeCoverage} />
        </Card>

        <Card>
          <CardHeader title="BA Performance" action={<Link to="/ho/leaderboard" className="text-xs font-semibold text-brand-600">Leaderboard</Link>} />
          <div className="space-y-2">
            {baRanking.slice(0, 4).map((b, i) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="mr-2 font-bold text-brand-600">#{i + 1}</span>
                  {b.name}
                </span>
                <span className="text-xs text-slate-500">{b.conversion}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="AI Recommendations"
            subtitle="Updated 10 minutes ago"
            action={
              <Link to="/ho/optimization" className="text-xs font-semibold text-brand-600">
                View all
              </Link>
            }
          />
          <div className="space-y-3">
            {aiRecommendations.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start gap-2">
                  <Zap size={15} className="mt-0.5 text-warning" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{r.pattern}</div>
                    <div className="text-xs text-slate-500">{r.store}</div>
                    <p className="mt-1 text-xs text-slate-600">{r.action}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Top Stores" />
            {storeRanking.map((s) => (
              <Link
                key={s.id}
                to={`/ho/stores/${s.id}`}
                className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm hover:bg-brand-50"
              >
                <span>
                  #{s.id} {s.name}
                </span>
                <StatusBadge status={s.conversion > 32 ? 'High' : 'Medium'} />
              </Link>
            ))}
          </Card>
          <Card>
            <CardHeader title="FAQ Log" subtitle="From shopper AI chats" />
            {faqs.map((f) => (
              <div key={f.q} className="mb-2 flex justify-between gap-2 text-xs">
                <span className="text-slate-600">{f.q}</span>
                <span className="font-semibold text-slate-900">{f.count}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex items-center justify-between border-b border-slate-50 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  )
}

function MiniBars({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span>{r.label}</span>
            <span className="font-semibold">{r.value}%</span>
          </div>
          <ProgressBar value={r.value} />
        </div>
      ))}
    </div>
  )
}

export function BaDailyReportsPage() {
  const reports = useDailyReports()
  const [openId, setOpenId] = useState<string | null>(null)
  const openReport = reports.find((report) => report.id === openId) ?? null

  function extract(kind: ExtractKind) {
    if (reports.length === 0) return
    void downloadReportExtract(kind, reports)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">BA daily reports</h2>
          <p className="text-sm text-slate-500">
            {reports.length
              ? `${reports.length} received in this browser`
              : 'Stock, daily sales, and competitor prices appear here when a BA submits'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!reports.length} onClick={() => extract('stock')}>
            <Download size={14} /> Stock Report
          </Button>
          <Button size="sm" variant="secondary" disabled={!reports.length} onClick={() => extract('sales')}>
            <Download size={14} /> Daily Sales
          </Button>
          <Button size="sm" variant="secondary" disabled={!reports.length} onClick={() => extract('competitors')}>
            <Download size={14} /> Competitor data
          </Button>
        </div>
      </div>

      <Card>
        {reports.length === 0 ? (
          <p className="text-sm text-slate-500">No daily reports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="py-2 pr-3">BA</th>
                  <th className="py-2 pr-3">City</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id} className="border-t border-slate-100">
                    <td className="py-2.5 pr-3 font-semibold text-slate-900">{report.baName}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{report.city || '—'}</td>
                    <td className="py-2.5 pr-3 text-slate-600">
                      {new Date(report.submittedAt).toLocaleString('en-PK', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 pr-3 capitalize text-slate-600">{report.source}</td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === report.id ? null : report.id)}
                        className="text-xs font-semibold text-brand-600"
                      >
                        {openId === report.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openReport && (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <ReportSlice title="Stock Report" rows={labeledStock(openReport.stock)} />
            <ReportSlice title="Daily Sales" rows={labeledSales(openReport.sales).filter((row) => row.value)} />
            <ReportSlice
              title="Competitor data"
              rows={openReport.otherBrands.map((brand) => ({
                section: 'Other Brands',
                item: brand.name,
                value: brand.price || '—',
              }))}
            />
          </div>
        )}
      </Card>
    </div>
  )
}

function ReportSlice({
  title,
  rows,
}: {
  title: string
  rows: { section: string; item: string; value: string }[]
}) {
  const filled = rows.filter((row) => row.value)
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">{title}</div>
      {filled.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Nothing submitted.</p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
          {filled.map((row) => (
            <li key={`${row.section}-${row.item}`} className="flex justify-between gap-3">
              <span className="text-slate-600">{row.item}</span>
              <span className="font-semibold text-slate-900">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function OptimizationPage() {
  return (
    <div className="space-y-5">
      <div>
        <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
          <Sparkles size={13} /> Updated 10 minutes ago
        </div>
        <h2 className="mt-3 text-xl font-bold text-slate-900">Today&apos;s Recommendations</h2>
        <p className="text-sm text-slate-500">
          Pattern detection across engagement, conversion, foot traffic, and sales.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {aiRecommendations.map((r) => (
          <Card key={r.id} className="animate-fade-up">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
              <Zap size={16} className="text-warning" />
              {r.pattern}
            </div>
            <div className="text-sm text-slate-600">{r.store}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Engagement</div>
                <div className="font-bold">{r.engagement}%</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Conversion</div>
                <div className="font-bold">{r.conversion}%</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-700">
              <span className="font-semibold">Recommendation: </span>
              {r.action}
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                to="/ho/stores/12"
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50"
              >
                View Store
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
