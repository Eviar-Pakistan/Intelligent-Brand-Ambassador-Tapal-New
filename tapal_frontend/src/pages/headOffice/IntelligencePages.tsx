import { djangoFetch, djangoToken } from '../../lib/djangoApi'
import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CertificationRulesPanel } from './CertificationRulesPanel'
import {
  consumerInsights,
  initialConsumerStoreQuestions,
  settingsSections,
  stores,
  type ConsumerStoreQuestion,
} from '../../data/mock'
import { useDemo } from '../../context/AppContext'
import {
  Button,
  Card,
  PageHeader,
  ProgressBar,
  Select,
  TableScroll,
} from '../../components/ui'
import { ReportPerformance } from './ReportPerformance'
import { Plus, Trash2 } from 'lucide-react'

export function ConsumersPage() {
  const demo = useDemo()
  const [storeId, setStoreId] = useState<string>('all')
  const [questions, setQuestions] = useState<ConsumerStoreQuestion[]>(initialConsumerStoreQuestions)
  const [newQuestion, setNewQuestion] = useState('')

  const storeMap = useMemo(
    () => Object.fromEntries(stores.map((s) => [s.id, s])),
    [],
  )

  const filteredQuestions = useMemo(() => {
    if (storeId === 'all') return questions
    return questions.filter((q) => String(q.storeId) === storeId)
  }, [questions, storeId])

  function addQuestion() {
    if (!newQuestion.trim() || storeId === 'all') return
    setQuestions((prev) => [
      {
        id: `cq-${Date.now()}`,
        storeId: Number(storeId),
        prompt: newQuestion.trim(),
        responses: 0,
      },
      ...prev,
    ])
    setNewQuestion('')
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => prev.filter((q) => q.id !== id))
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Consumer Intelligence"
        description={`${demo.shoppers.toLocaleString()} consumer profiles · Module 5 capture`}
      />
      <div className="flex flex-wrap gap-2">
        {['City', 'Age Group', 'Family Size', 'Current Brand', 'Purchase Frequency', 'Price Sensitivity', 'SKU'].map(
          (f) => (
            <Select key={f} defaultValue="" className="w-full min-w-[8rem] flex-1 sm:w-auto sm:flex-none">
              <option value="">{f}</option>
              <option>All</option>
            </Select>
          ),
        )}
        <Select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="w-full min-w-[10rem] flex-1 sm:w-auto sm:flex-none"
        >
          <option value="all">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              #{s.id} {s.name}
            </option>
          ))}
        </Select>
      </div>

      <Card padding={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-50 px-4 py-3 sm:px-5">
          <div>
            <h3 className="font-semibold text-slate-900">Consumer questions by store</h3>
            <p className="text-xs text-slate-500">
              {storeId === 'all'
                ? 'All stores'
                : `#${storeId} ${storeMap[Number(storeId)]?.name ?? ''}`}
              {' · '}
              {filteredQuestions.length} question{filteredQuestions.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {storeId !== 'all' && (
          <div className="flex flex-wrap gap-2 border-b border-slate-50 px-4 py-3 sm:px-5">
            <input
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="Add a question for this store..."
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <Button size="sm" disabled={!newQuestion.trim()} onClick={addQuestion}>
              <Plus size={14} /> Add question
            </Button>
          </div>
        )}

        {filteredQuestions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500 sm:px-5">
            {storeId === 'all'
              ? 'No consumer questions yet.'
              : 'No questions for this store. Add one above.'}
          </p>
        ) : (
          <TableScroll minWidth={640}>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Question</th>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Responses</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuestions.map((q, i) => {
                  const store = storeMap[q.storeId]
                  return (
                    <tr key={q.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{q.prompt}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {store ? (
                          <>
                            <div>
                              #{store.id} {store.name}
                            </div>
                            <div className="text-xs text-slate-400">{store.city}</div>
                          </>
                        ) : (
                          `Store #${q.storeId}`
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-slate-800">
                        {q.responses.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="ghost" onClick={() => removeQuestion(q.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Preferred Tea Brand" rows={consumerInsights.preferredTea} />
        <ChartCard title="Family Size" rows={consumerInsights.familySize} />
        <ChartCard title="Purchase Frequency" rows={consumerInsights.purchaseFrequency} />
        <ChartCard title="Price Sensitivity" rows={consumerInsights.priceSensitivity} />
        <ChartCard title="Health Preference" rows={consumerInsights.healthPreference} />
        <Card>
          <h3 className="mb-3 font-semibold">CRM Sync Status</h3>
          <p className="text-sm text-slate-600">
            Mock feed: every shopper session upserts preference data after consent. Repeat shoppers
            update existing profiles.
          </p>
          <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Last sync: just now · {demo.sessionComplete ? 'New profile written' : 'Idle'}
          </div>
        </Card>
      </div>
    </div>
  )
}

function ChartCard({ title, rows }: { title: string; rows: { name: string; value: number }[] }) {
  return (
    <Card>
      <h3 className="mb-4 font-semibold">{title}</h3>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{r.name}</span>
              <span className="font-semibold">{r.value}%</span>
            </div>
            <ProgressBar value={r.value} />
          </div>
        ))}
      </div>
    </Card>
  )
}

type LeaderRow = {
  id: number
  rank: number
  name: string
  ba_code: string
  city: string
  store_name: string | null
  points: number
  days_present: number
  check_ins_this_week: number
  interactions: number
  switched: number
  conversion: number
  target_achievement: number | null
  customer_rating: number | null
}

export function LeaderboardPage() {
  const [data, setData] = useState<{ week_label: string; results: LeaderRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!djangoToken()) {
      setError('Sign in to Head Office to see the leaderboard.')
      return
    }
    let cancelled = false
    const load = () =>
      djangoFetch('/api/intelligence/leaderboard/')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((next) => !cancelled && setData(next))
        .catch(() => !cancelled && setError('The leaderboard could not be loaded.'))
    void load()
    const id = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ambassador Leaderboard"
        description={`This week${data ? ` · ${data.week_label}` : ''} · every active BA, ranked on field performance`}
        actions={
          <Link to="/ho/incentives">
            <Button>Manage PKR incentives</Button>
          </Link>
        }
      />
      <p className="text-xs text-slate-500">
        Points: 50 per day present (checked in, report submitted, checked out) · 20 per day only checked in · 10 per
        shopper intercepted · 15 per shopper who switched to Tapal · 2 × this month&apos;s target achievement % (max 150%)
        · 20 × shopper rating.
      </p>
      <Card padding={false}>
        {error ? (
          <p className="px-4 py-6 text-sm text-rose-700">{error}</p>
        ) : (
          <TableScroll minWidth={900}>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Ambassador</th>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Points</th>
                  <th className="px-4 py-3">Days present</th>
                  <th className="px-4 py-3">Intercepted</th>
                  <th className="px-4 py-3">Conversion</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Rating</th>
                </tr>
              </thead>
              <tbody>
                {(data?.results ?? []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-bold text-brand-600">#{row.rank}</td>
                    <td className="px-4 py-3">
                      <Link to={`/ho/ambassadors/api-${row.id}`} className="font-medium hover:text-brand-600">
                        {row.name}
                      </Link>
                      <div className="font-mono text-xs text-slate-400">
                        {[row.ba_code, row.city].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.store_name || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{row.points.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {row.days_present}
                      {row.check_ins_this_week > row.days_present && (
                        <span className="text-xs text-slate-400"> (+{row.check_ins_this_week - row.days_present} partial)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{row.interactions}</td>
                    <td className="px-4 py-3">
                      {row.interactions ? `${row.conversion}%` : '—'}
                      {row.switched > 0 && <span className="text-xs text-slate-400"> ({row.switched})</span>}
                    </td>
                    <td className="px-4 py-3">{row.target_achievement != null ? `${row.target_achievement}%` : '—'}</td>
                    <td className="px-4 py-3">{row.customer_rating != null ? `${row.customer_rating} ★` : '—'}</td>
                  </tr>
                ))}
                {data && data.results.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                      No active ambassadors yet.
                    </td>
                  </tr>
                )}
                {!data && !error && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="font-bold">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

export function ReportPage() {
  const demo = useDemo()
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Executive Intelligence Report"
        description="Store performance, BA attendance and incentives, target vs achievement"
        actions={<Button>Export Report</Button>}
      />
      <Card>
        <div className="text-xs tracking-[0.2em] text-brand-600 uppercase">Executive Intelligence Report</div>
        <h2 className="mt-2 text-2xl font-bold text-black sm:text-3xl">Tapal Tea</h2>
        <p className="mt-1 text-slate-500">Campaign Performance · Aug–Sep 2026</p>
      </Card>

      <Section n="01" title="Executive Summary">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Shoppers" value={demo.shoppers.toLocaleString()} />
          <Mini label="Conversion" value={`${demo.conversion}%`} />
          <Mini label="Stores" value={String(demo.stores)} />
          <Mini label="Engagement" value={`${demo.engagement}%`} />
        </div>
      </Section>

      <ReportPerformance />

      <Section n="05" title="Consumer Profile">
        <p className="text-sm text-slate-600">
          Primary buyers are family households (3–4 members) shopping bi-weekly, with medium price
          sensitivity and strong interest in rich taste and everyday chai moments.
        </p>
      </Section>

      <Section n="06" title="Brand Switching">
        <p className="text-sm text-slate-600">
          Top switch drivers: taste comparison vs other tea brands, doodh patti aroma, and sample-pack
          trial offers. Main rejection reason remains habit loyalty to Lipton.
        </p>
      </Section>

      <Section n="07" title="Product Performance">
        <ChartCard
          title="SKU Interest"
          rows={[
            { name: 'Danedar 475g', value: 48 },
            { name: 'Tea Bags 50s', value: 32 },
            { name: 'Danedar 190g', value: 20 },
          ]}
        />
      </Section>

      <Section n="08" title="Regional Performance">
        <ChartCard
          title="City contribution"
          rows={[
            { name: 'Lahore', value: 41 },
            { name: 'Karachi', value: 32 },
            { name: 'Islamabad', value: 18 },
            { name: 'Others', value: 9 },
          ]}
        />
      </Section>

      <Section n="09" title="AI Recommendations">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Increase Lahore weekend coverage</li>
          <li>Promote Danedar 475g in family-size segments</li>
          <li>Improve objection handling scripts for habit brands</li>
        </ol>
      </Section>
    </div>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 text-xs font-bold tracking-wide text-brand-600 uppercase">
        {n} — {title}
      </div>
      {children}
    </Card>
  )
}

export function SettingsPage() {
  const [section, setSection] = useState('Certification Rules')
  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <Card padding={false}>
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Campaign Configuration</div>
        <nav className="p-2">
          {settingsSections.map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`mb-0.5 w-full rounded-xl px-3 py-2 text-left text-sm ${
                section === s ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s}
            </button>
          ))}
        </nav>
      </Card>
      <Card>
        <h2 className="text-xl font-bold">{section}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {section === 'Certification Rules'
            ? 'This score decides whether the NLP assessment certifies or rejects a brand ambassador.'
            : 'Administrator configuration surface. Content is campaign-configurable per the feature spec.'}
        </p>
        {section === 'Certification Rules' && (
          <div className="mt-5">
            <CertificationRulesPanel />
          </div>
        )}
        {section === 'Training Scenarios' && (
          <div className="mt-5 space-y-3">
            {['Why switch from Lipton?', 'Is it good for doodh patti?', 'Which pack for family of 5?'].map((s) => (
              <div key={s} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                {s}
              </div>
            ))}
            <Button variant="secondary">Add scenario</Button>
          </div>
        )}
        {section !== 'Certification Rules' && section !== 'Training Scenarios' && (
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            Configuration panel for <strong>{section}</strong> — ready for detailed admin forms in
            later iterations.
          </div>
        )}
      </Card>
    </div>
  )
}

