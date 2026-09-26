import { Link } from 'react-router-dom'
import { useMemo, useState, type ReactNode } from 'react'
import {
  baRanking,
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
  StatusBadge,
  TableScroll,
} from '../../components/ui'
import { buildIncentiveRoster, formatPkr } from '../../lib/incentives'
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

export function LeaderboardPage() {
  const incentives = buildIncentiveRoster()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ambassador Leaderboard"
        description="This week · gamified incentive program"
        actions={
          <Link to="/ho/incentives">
            <Button>Manage PKR incentives</Button>
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {baRanking.slice(0, 3).map((b, i) => {
          const pay = incentives.find((x) => x.baId === b.id)
          return (
            <Card key={b.id} className={i === 0 ? 'ring-2 ring-amber-300' : ''}>
              <div className="text-3xl">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
              <h3 className="mt-2 text-lg font-bold">{b.name}</h3>
              <p className="text-sm text-slate-500">{b.city}</p>
              <div className="mt-3 text-2xl font-black text-brand-600">
                {b.points.toLocaleString()} pts
              </div>
              <div className="mt-1 text-xs text-slate-500">{b.conversion}% conversion</div>
              {pay && (
                <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                  {formatPkr(pay.totalPkr)} incentive
                </div>
              )}
            </Card>
          )
        })}
      </div>
      <Card>
        <h3 className="mb-3 font-semibold">Your Rank (demo BA view)</h3>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-4xl font-black">#7</div>
            <div className="text-sm text-slate-500">820 points · +120 this week</div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Mini label="Conversation Rate" value="88%" />
            <Mini label="Conversion Rate" value="31%" />
            <Mini label="Customer Rating" value="4.8" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <StatusBadge status="Active" />
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
            {formatPkr(incentives[0]?.totalPkr ?? 2000)} top-tier example
          </span>
          <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200">
            Gold Badge
          </span>
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-500/20">
            Top Performer
          </span>
        </div>
      </Card>
      <Card padding={false}>
        <TableScroll minWidth={720}>
          <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Ambassador</th>
              <th className="px-4 py-3">City</th>
              <th className="px-4 py-3">Points</th>
              <th className="px-4 py-3">Conversion</th>
              <th className="px-4 py-3">Incentive (PKR)</th>
            </tr>
          </thead>
          <tbody>
            {baRanking.map((b, i) => {
              const pay = incentives.find((x) => x.baId === b.id)
              return (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-bold text-brand-600">#{i + 1}</td>
                  <td className="px-4 py-3">
                    <Link to={`/ho/ambassadors/${b.id}`} className="font-medium hover:text-brand-600">
                      {b.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{b.city}</td>
                  <td className="px-4 py-3">{b.points}</td>
                  <td className="px-4 py-3">{b.conversion}%</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">
                    {pay ? formatPkr(pay.totalPkr) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </TableScroll>
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
          Administrator configuration surface — mock controls for showcase. Content is
          campaign-configurable per the feature spec.
        </p>
        {section === 'Certification Rules' && (
          <div className="mt-5 space-y-4">
            <Field label="Pass threshold" value="75" />
            <Field label="A+ threshold" value="90" />
            <Field label="Required criteria" value="5 / 5 scored" />
            <Button>Save rules</Button>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        defaultValue={value}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
      />
    </label>
  )
}
