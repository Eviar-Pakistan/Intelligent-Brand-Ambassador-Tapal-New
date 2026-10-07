import { useEffect, useState } from 'react'
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
import { aiRecommendations } from '../../data/mock'
import { useBrand } from '../../context/BrandContext'
import { LiveStoreMap, type StoreMapPin } from '../../components/LiveStoreMap'
import { djangoFetch, djangoToken } from '../../lib/djangoApi'
import { Button, Card, CardHeader, KpiCard, Modal, ProgressBar } from '../../components/ui'
import {
  downloadReportExtract,
  labeledSales,
  labeledStock,
  salesFieldEntries,
  STOCK_OPTIONS,
  stockFieldEntries,
  updateDailyReportAsMis,
  useDailyReports,
  type ExtractKind,
  type OtherBrandRow,
  type StoredDailyReport,
} from '../../lib/baReport'
import { isMisUser, useDjangoUser } from '../../lib/djangoApi'
import { Download, Search, Sparkles, Zap } from 'lucide-react'

type MetricsPin = StoreMapPin & { status: string }

type CampaignMetrics = {
  generated_at: string
  kpis: {
    shoppers_engaged: number
    shoppers_today: number
    active_stores: number
    total_stores: number
    engagement_rate: number
    conversion_rate: number
    conversion_this_week: number
    conversion_last_week: number
  }
  engagement_trend: { day: string; date: string; engagement: number; conversion: number }[]
  map_pins: MetricsPin[]
  consumer_insight: { title: string; rows: { name: string; value: number }[] } | null
  shopper_intelligence: { footfall: string; engagement_rate: string; purchase_intent: string; conversion_rate: string }
  operations: {
    active_bas: number
    gps_online: number
    scheduled_today: number
    checked_in_today: number
    attendance_rate: number
    stores_covered: number
    live_stores: number
    store_coverage: number
  }
  top_bas: { id: number; name: string; conversion: number; points: number }[]
  recommendations: { id: number; store: string; pattern: string; action: string }[]
  top_stores: MetricsPin[]
}

const REFRESH_MS = 60_000

function useCampaignMetrics() {
  const [data, setData] = useState<CampaignMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!djangoToken()) {
      setError('Sign in to Head Office to see live campaign metrics.')
      return
    }
    let cancelled = false
    const load = () =>
      djangoFetch('/api/intelligence/campaign-metrics/')
        .then(async (response) => {
          if (!response.ok) throw new Error()
          const next = (await response.json()) as CampaignMetrics
          if (!cancelled) {
            setData(next)
            setError(null)
          }
        })
        .catch(() => !cancelled && setError('Live metrics could not be loaded. Check that the server is running.'))
    void load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return { data, error }
}

function signed(value: number, unit: string) {
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded}${unit}`
}

export function CommandCenterPage() {
  const { brand } = useBrand()
  const { data, error } = useCampaignMetrics()

  if (!data) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Performance overview</h2>
          <p className="text-sm text-slate-500">{brand.productName} · live Retail Command Center</p>
        </div>
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : (
          <Card>
            <p className="py-10 text-center text-sm text-slate-500">Loading live metrics…</p>
          </Card>
        )}
      </div>
    )
  }

  const { kpis, operations: ops } = data
  const updated = new Date(data.generated_at).toLocaleTimeString('en-PK', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Performance overview</h2>
          <p className="text-sm text-slate-500">{brand.productName} · live Retail Command Center</p>
        </div>
        <span className="text-xs text-slate-400">
          Updated {updated}
          {error ? ' · last refresh failed' : ''}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Shoppers Engaged"
          value={kpis.shoppers_engaged.toLocaleString()}
          delta={`+${kpis.shoppers_today} today`}
        />
        <KpiCard
          label="Active Stores"
          value={kpis.active_stores}
          delta={`${ops.gps_online} ${ops.gps_online === 1 ? 'BA' : 'BAs'} GPS online`}
        />
        <KpiCard label="Engagement Rate" value={`${kpis.engagement_rate}%`} delta={`of ${kpis.total_stores} stores`} />
        <KpiCard
          label="Conversion Rate"
          value={`${kpis.conversion_rate}%`}
          delta={`${signed(kpis.conversion_this_week - kpis.conversion_last_week, ' pts')} WoW`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Engagement Trend" subtitle="Shoppers per day · last 7 days" />
          <div className="h-52 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.engagement_trend}>
                <defs>
                  <linearGradient id="eng" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="engagement"
                  name="Shoppers"
                  stroke="#dc2626"
                  fill="url(#eng)"
                  strokeWidth={2}
                />
                <Area type="monotone" dataKey="conversion" name="Converted" stroke="#16a34a" fill="none" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Live Store Map" subtitle="Performance pins" />
          <LiveStoreMap pins={data.map_pins} />
          <div className="mt-3 flex gap-3 text-[11px] text-slate-500">
            <span className="text-[#16a34a]">● High</span>
            <span className="text-[#f59e0b]">● Medium</span>
            <span className="text-[#e11d48]">● Low</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-4">
        <Card>
          <CardHeader title="Consumer Insights" />
          {data.consumer_insight ? (
            <>
              <MiniBars rows={data.consumer_insight.rows.map((x) => ({ label: x.name, value: x.value }))} />
              <div className="mt-3 text-[11px] text-slate-400">{data.consumer_insight.title}</div>
            </>
          ) : (
            <p className="text-sm text-slate-500">No survey answers yet.</p>
          )}
          <Link to="/ho/consumers" className="mt-3 inline-block text-xs font-semibold text-brand-600">
            Open full intelligence →
          </Link>
        </Card>

        <Card>
          <CardHeader title="Shopper Intelligence" />
          <StatRow label="Footfall" value={data.shopper_intelligence.footfall} />
          <StatRow label="Engagement" value={data.shopper_intelligence.engagement_rate} />
          <StatRow label="Purchase intent" value={data.shopper_intelligence.purchase_intent} />
          <StatRow label="Conversion" value={data.shopper_intelligence.conversion_rate} />
        </Card>

        <Card>
          <CardHeader title="Operations" subtitle="Today" />
          <StatRow label="Active BAs" value={String(ops.active_bas)} />
          <StatRow label="GPS online" value={String(ops.gps_online)} />
          <StatRow label="Attendance" value={`${ops.attendance_rate}% (${ops.checked_in_today}/${ops.scheduled_today})`} />
          <StatRow label="Store coverage" value={`${ops.store_coverage}% (${ops.stores_covered}/${ops.live_stores})`} />
        </Card>

        <Card>
          <CardHeader
            title="BA Performance"
            action={
              <Link to="/ho/leaderboard" className="text-xs font-semibold text-brand-600">
                Leaderboard
              </Link>
            }
          />
          <div className="space-y-2">
            {data.top_bas.map((b, i) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="mr-2 font-bold text-brand-600">#{i + 1}</span>
                  {b.name}
                </span>
                <span className="text-xs text-slate-500">{b.conversion}%</span>
              </div>
            ))}
            {data.top_bas.length === 0 && <p className="text-sm text-slate-500">No certified ambassadors yet.</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="AI Recommendations" subtitle={`From live store data · ${updated}`} />
          <div className="space-y-3">
            {data.recommendations.map((r) => (
              <Link
                key={`${r.id}-${r.pattern}`}
                to={`/ho/stores/${r.id}`}
                className="block rounded-xl border border-slate-100 bg-slate-50 p-3 hover:bg-brand-50"
              >
                <div className="flex items-start gap-2">
                  <Zap size={15} className="mt-0.5 text-warning" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{r.pattern}</div>
                    <div className="text-xs text-slate-500">{r.store}</div>
                    <p className="mt-1 text-xs text-slate-600">{r.action}</p>
                  </div>
                </div>
              </Link>
            ))}
            {data.recommendations.length === 0 && (
              <p className="text-sm text-slate-500">No store needs attention right now.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Top Stores" subtitle="By shoppers engaged" />
          {data.top_stores.length === 0 && <p className="text-sm text-slate-500">No stores yet.</p>}
          {data.top_stores.map((s) => (
            <Link
              key={s.id}
              to={`/ho/stores/${s.id}`}
              className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm hover:bg-brand-50"
            >
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="shrink-0 text-xs text-slate-500">
                {s.shoppers} shoppers · {s.conversion_rate}%
              </span>
            </Link>
          ))}
        </Card>
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
  const officeUser = useDjangoUser()
  const canEdit = isMisUser(officeUser)
  const [openId, setOpenId] = useState<string | null>(null)
  const [nameQuery, setNameQuery] = useState('')
  const openReport = reports.find((report) => report.id === openId) ?? null

  const query = nameQuery.trim().toLowerCase()
  const filteredReports = query
    ? reports.filter((report) => {
        const name = (report.baName || '').toLowerCase()
        const code = (report.baCode || '').toLowerCase()
        return name.includes(query) || code.includes(query)
      })
    : reports

  function extract(kind: ExtractKind) {
    if (filteredReports.length === 0) return
    void downloadReportExtract(kind, filteredReports)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">BA daily reports</h2>
          <p className="text-sm text-slate-500">
            {reports.length
              ? query
                ? `${filteredReports.length} of ${reports.length} reports`
                : `${reports.length} received from BAs`
              : 'Stock, daily sales, and competitor prices appear here when a BA submits'}
            {canEdit ? ' · You can edit report values as MIS.' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!filteredReports.length} onClick={() => extract('stock')}>
            <Download size={14} /> Stock Report
          </Button>
          <Button size="sm" variant="secondary" disabled={!filteredReports.length} onClick={() => extract('sales')}>
            <Download size={14} /> Daily Sales
          </Button>
          <Button size="sm" variant="secondary" disabled={!filteredReports.length} onClick={() => extract('competitors')}>
            <Download size={14} /> Competitor data
          </Button>
        </div>
      </div>

      <Card>
        {reports.length === 0 ? (
          <p className="text-sm text-slate-500">No daily reports yet.</p>
        ) : (
          <>
            <label className="mb-4 flex max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input
                type="search"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="Search by BA name…"
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
            {filteredReports.length === 0 ? (
              <p className="text-sm text-slate-500">No reports match “{nameQuery.trim()}”.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th className="py-2 pr-3">BA</th>
                      <th className="py-2 pr-3">Store</th>
                      <th className="py-2 pr-3">City</th>
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReports.map((report) => (
                      <tr key={report.id} className="border-t border-slate-100">
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-slate-900">{report.baName}</div>
                          {report.baCode && <div className="font-mono text-xs text-slate-400">{report.baCode}</div>}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600">{report.storeName || '—'}</td>
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
                            onClick={() => setOpenId(report.id)}
                            className="text-xs font-semibold text-brand-600"
                          >
                            {canEdit ? 'Edit' : 'View'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        open={!!openReport}
        onClose={() => setOpenId(null)}
        wide
        title={
          openReport
            ? `${openReport.baName}${openReport.storeName ? ` · ${openReport.storeName}` : ''}`
            : 'Report'
        }
      >
        {openReport &&
          (canEdit ? (
            <MisReportEditor report={openReport} onClose={() => setOpenId(null)} />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                {[openReport.city, openReport.source, new Date(openReport.submittedAt).toLocaleString('en-PK')]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            </div>
          ))}
      </Modal>
    </div>
  )
}

function MisReportEditor({ report, onClose }: { report: StoredDailyReport; onClose: () => void }) {
  const [stock, setStock] = useState(() => ({ ...report.stock }))
  const [sales, setSales] = useState(() => ({ ...report.sales }))
  const [brands, setBrands] = useState<OtherBrandRow[]>(() =>
    report.otherBrands.map((row) => ({ ...row })),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setStock({ ...report.stock })
    setSales({ ...report.sales })
    setBrands(report.otherBrands.map((row) => ({ ...row })))
    setError(null)
    setSaved(false)
  }, [report.id, report.stock, report.sales, report.otherBrands])

  const stockRows = stockFieldEntries(stock)
  const salesRows = salesFieldEntries(sales)
  const totalKg = sales.totalSalesKg

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await updateDailyReportAsMis(report.id, { stock, sales, otherBrands: brands })
      setStock({ ...next.stock })
      setSales({ ...next.sales })
      setBrands(next.otherBrands.map((row) => ({ ...row })))
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {[report.city, report.source, new Date(report.submittedAt).toLocaleString('en-PK')]
          .filter(Boolean)
          .join(' · ')}
        {' · '}
        <span className="font-semibold text-brand-700">Editable (MIS)</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">Stock Report</div>
          {stockRows.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nothing submitted.</p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-xs">
              {stockRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-slate-600">{row.label}</span>
                  <select
                    value={STOCK_OPTIONS.includes(row.value as (typeof STOCK_OPTIONS)[number]) ? row.value : row.value || 'In Stock'}
                    onChange={(e) => setStock((prev) => ({ ...prev, [row.key]: e.target.value }))}
                    className="max-w-[9.5rem] rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-900 outline-none focus:border-brand-500"
                  >
                    {!STOCK_OPTIONS.includes(row.value as (typeof STOCK_OPTIONS)[number]) && row.value ? (
                      <option value={row.value}>{row.value}</option>
                    ) : null}
                    {STOCK_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">Daily Sales</div>
          {salesRows.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nothing submitted.</p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-xs">
              {salesRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-slate-600">{row.label}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.value}
                    onChange={(e) => setSales((prev) => ({ ...prev, [row.key]: e.target.value }))}
                    className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-semibold text-slate-900 outline-none focus:border-brand-500"
                  />
                </li>
              ))}
              {totalKg !== undefined && totalKg !== '' && (
                <li className="flex justify-between gap-2 border-t border-slate-200 pt-2">
                  <span className="text-slate-600">Total Sales (Kg)</span>
                  <span className="font-semibold text-slate-900">{totalKg}</span>
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">Competitor data</div>
          {brands.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nothing submitted.</p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-xs">
              {brands.map((brand, index) => (
                <li key={brand.id || `${brand.name}-${index}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-slate-600">{brand.name || '—'}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={brand.price}
                    onChange={(e) =>
                      setBrands((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, price: e.target.value } : row)),
                      )
                    }
                    className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-semibold text-slate-900 outline-none focus:border-brand-500"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {saved && !error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Changes saved.
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
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
