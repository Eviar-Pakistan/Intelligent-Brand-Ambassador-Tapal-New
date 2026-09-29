import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, StatusBadge } from '../../components/ui'
import { djangoFetch, djangoToken } from '../../lib/djangoApi'
import { CITIES, FOOTFALLS, type CreatedStore } from '../../lib/storeRegistry'

const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500'

async function call<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!djangoToken()) throw new Error('Sign in to Head Office to continue.')
  const response = await djangoFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  if (response.status === 204) return undefined as T
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const first = Object.values(data)[0]
    throw new Error(
      typeof data.detail === 'string' ? data.detail : Array.isArray(first) ? String(first[0]) : 'The change could not be saved.',
    )
  }
  return data as T
}

async function refreshStores() {
  const { syncDjango } = await import('../../lib/djangoSync')
  await syncDjango()
}

function useNotice() {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      setNotice({ ok: true, text: success })
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'The change could not be saved.' })
    }
    setBusy(false)
  }, [])
  const view = notice && (
    <p
      className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
        notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
      }`}
    >
      {notice.text}
    </p>
  )
  return { run, busy, view }
}

// ─── Footfall ────────────────────────────────────────────────────────────────

export function StoreFootfallCard({ storeId, today }: { storeId: number; today: number }) {
  const [count, setCount] = useState(today ? String(today) : '')
  const { run, busy, view } = useNotice()
  return (
    <Card>
      <h3 className="font-semibold">Today&apos;s footfall</h3>
      <p className="mt-1 text-xs text-slate-500">
        Shoppers who walked in today. The BA can also enter it from their app. Engagement = shoppers engaged ÷ footfall.
      </p>
      <div className="mt-3 flex gap-2">
        <input type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} className={field} />
        <Button
          disabled={busy || count === ''}
          onClick={() =>
            void run(async () => {
              await call(`/api/stores/${storeId}/footfall/`, 'POST', { count: Number(count) })
              await refreshStores()
            }, 'Footfall saved for today.')
          }
        >
          Save
        </Button>
      </div>
      {view}
    </Card>
  )
}

// ─── Edit / deactivate / delete ─────────────────────────────────────────────

export function StoreSettingsCard({ record, inactive }: { record: CreatedStore; inactive: boolean }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    store_code: record.storeCode,
    name: record.name,
    city: record.city,
    address: record.address,
    footfall: record.footfall,
    peak_hours: record.peakHours,
    contact_name: record.contactPerson,
    contact_phone: record.contactPhone,
    latitude: record.latitude === null ? '' : String(record.latitude),
    longitude: record.longitude === null ? '' : String(record.longitude),
  })
  const { run, busy, view } = useNotice()
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))
  const text = (key: keyof typeof form, label: string) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input value={form[key]} onChange={set(key)} className={field} />
    </label>
  )

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Store settings</h3>
        {inactive && <StatusBadge status="Inactive" />}
      </div>
      {editing ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {text('store_code', 'Store code *')}
          {text('name', 'Store name *')}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">City *</span>
            <select value={form.city} onChange={set('city')} className={field}>
              {[...new Set([form.city, ...CITIES])].filter(Boolean).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Footfall level</span>
            <select value={form.footfall} onChange={set('footfall')} className={field}>
              {FOOTFALLS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">{text('address', 'Address *')}</div>
          {text('peak_hours', 'Peak hours')}
          {text('contact_name', 'Contact person')}
          {text('contact_phone', 'Contact phone')}
          <div className="grid grid-cols-2 gap-2">
            {text('latitude', 'Latitude')}
            {text('longitude', 'Longitude')}
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              disabled={busy || !form.name.trim() || !form.store_code.trim() || !form.address.trim()}
              onClick={() =>
                void run(async () => {
                  await call(`/api/stores/${record.id}/`, 'PATCH', {
                    ...form,
                    store_code: form.store_code.trim().toUpperCase(),
                    latitude: form.latitude === '' ? null : Number(form.latitude),
                    longitude: form.longitude === '' ? null : Number(form.longitude),
                  })
                  await refreshStores()
                  setEditing(false)
                }, 'Store details saved.')
              }
            >
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit details
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (!inactive && !window.confirm(`Deactivate ${record.name}? It stays in reports but is marked inactive.`)) return
              void run(async () => {
                await call(`/api/stores/${record.id}/`, 'PATCH', { status: inactive ? 'Pending' : 'INACTIVE' })
                await refreshStores()
              }, inactive ? 'Store reactivated.' : 'Store deactivated.')
            }}
          >
            {inactive ? 'Reactivate store' : 'Deactivate store'}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `Delete ${record.name} permanently?\n\nThis also deletes its shifts, attendance, shopper data, complaints and QR code. Deactivate instead to keep history.`,
                )
              )
                return
              void run(async () => {
                await call(`/api/stores/${record.id}/`, 'DELETE')
                await refreshStores()
                navigate(-1)
              }, 'Store deleted.')
            }}
          >
            <span className="text-rose-600">Delete store</span>
          </Button>
        </div>
      )}
      {view}
    </Card>
  )
}

// ─── Survey questions and rewards shown to this store's shoppers ────────────

type Question = { id: number; order: number; text: string; options: string[]; is_active: boolean; store: number | null }
type Reward = {
  id: number
  label: string
  win_amount: string
  win_detail: string
  promo_code: string
  is_active: boolean
  is_featured: boolean
  sort_order: number
}

const QUESTION_SLOTS = [
  { order: 1, hint: 'Shown as "Which tea do you currently use?"' },
  { order: 2, hint: 'Shown as the reasons question (shopper can pick several)' },
]

export function StoreShopperContentCard({ storeId }: { storeId: number }) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const { run, busy, view } = useNotice()

  const load = useCallback(async () => {
    const [q, r] = await Promise.all([
      call<Question[] | { results: Question[] }>(`/api/survey-questions/?store=${storeId}`),
      call<Reward[] | { results: Reward[] }>(`/api/store-rewards/?store=${storeId}`),
    ])
    setQuestions((Array.isArray(q) ? q : q.results).filter((item) => item.store === storeId))
    setRewards(Array.isArray(r) ? r : r.results)
  }, [storeId])

  useEffect(() => {
    void load().catch(() => undefined)
  }, [load])

  return (
    <Card>
      <h3 className="font-semibold">Shopper survey &amp; rewards</h3>
      <p className="mt-1 text-xs text-slate-500">
        What shoppers at this store see after scanning the QR code. Leave empty to use the standard questions and prize.
      </p>

      <div className="mt-4 space-y-4">
        {QUESTION_SLOTS.map((slot) => (
          <QuestionEditor
            key={slot.order}
            hint={slot.hint}
            order={slot.order}
            existing={questions.find((q) => q.order === slot.order) ?? null}
            busy={busy}
            onSave={(text, options, id) =>
              void run(async () => {
                const body = { store: storeId, order: slot.order, text, options, is_active: true }
                await (id ? call(`/api/survey-questions/${id}/`, 'PATCH', body) : call('/api/survey-questions/', 'POST', body))
                await load()
              }, 'Question saved.')
            }
            onRemove={(id) =>
              void run(async () => {
                await call(`/api/survey-questions/${id}/`, 'DELETE')
                await load()
              }, 'Question removed; the standard question is used again.')
            }
          />
        ))}
      </div>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <div className="text-sm font-semibold text-slate-800">Spin rewards</div>
        <p className="mt-0.5 text-xs text-slate-500">
          The featured reward is what the shopper wins; the first three active rewards are shown on the wheel.
        </p>
        <ul className="mt-3 space-y-2">
          {rewards.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  {r.label} · {r.win_amount}
                  {r.is_featured && <span className="ml-2 text-xs font-semibold text-brand-600">Featured</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {[r.win_detail, r.promo_code && `code ${r.promo_code}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex gap-1">
                {!r.is_featured && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await Promise.all(
                          rewards
                            .filter((x) => x.is_featured)
                            .map((x) => call(`/api/store-rewards/${x.id}/`, 'PATCH', { is_featured: false })),
                        )
                        await call(`/api/store-rewards/${r.id}/`, 'PATCH', { is_featured: true, is_active: true })
                        await load()
                      }, 'Featured reward changed.')
                    }
                  >
                    Feature
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call(`/api/store-rewards/${r.id}/`, 'DELETE')
                      await load()
                    }, 'Reward removed.')
                  }
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
          {rewards.length === 0 && <li className="text-xs text-slate-400">No rewards yet — the standard prize is used.</li>}
        </ul>
        <RewardForm
          busy={busy}
          onAdd={(reward) =>
            void run(async () => {
              await call('/api/store-rewards/', 'POST', {
                ...reward,
                store: storeId,
                is_active: true,
                is_featured: rewards.length === 0,
                sort_order: rewards.length,
              })
              await load()
            }, 'Reward added.')
          }
        />
      </div>
      {view}
    </Card>
  )
}

function QuestionEditor({
  order,
  hint,
  existing,
  busy,
  onSave,
  onRemove,
}: {
  order: number
  hint: string
  existing: Question | null
  busy: boolean
  onSave: (text: string, options: string[], id?: number) => void
  onRemove: (id: number) => void
}) {
  const [text, setText] = useState(existing?.text ?? '')
  const [options, setOptions] = useState((existing?.options ?? []).join('\n'))
  useEffect(() => {
    setText(existing?.text ?? '')
    setOptions((existing?.options ?? []).join('\n'))
  }, [existing])
  const list = options
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean)
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="text-xs font-semibold text-slate-700">Question {order}</div>
      <div className="text-[11px] text-slate-400">{hint}</div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Question text"
        className={`${field} mt-2`}
      />
      <textarea
        value={options}
        onChange={(e) => setOptions(e.target.value)}
        rows={4}
        placeholder="One answer per line"
        className={`${field} mt-2 resize-none`}
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy || !text.trim() || list.length < 2} onClick={() => onSave(text.trim(), list, existing?.id)}>
          Save question
        </Button>
        {existing && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(existing.id)}>
            Use standard question
          </Button>
        )}
      </div>
    </div>
  )
}

function RewardForm({
  busy,
  onAdd,
}: {
  busy: boolean
  onAdd: (reward: { label: string; win_amount: string; win_detail: string; promo_code: string }) => void
}) {
  const empty = { label: '', win_amount: '', win_detail: '', promo_code: '' }
  const [form, setForm] = useState(empty)
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input placeholder="Wheel label, e.g. Free Tea Sample" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={field} />
      <input placeholder="Prize, e.g. Rs. 100 OFF" value={form.win_amount} onChange={(e) => setForm({ ...form, win_amount: e.target.value })} className={field} />
      <input placeholder="Detail, e.g. on your next purchase" value={form.win_detail} onChange={(e) => setForm({ ...form, win_detail: e.target.value })} className={field} />
      <input placeholder="Promo code" value={form.promo_code} onChange={(e) => setForm({ ...form, promo_code: e.target.value.toUpperCase() })} className={field} />
      <div className="sm:col-span-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !form.label.trim() || !form.win_amount.trim()}
          onClick={() => {
            onAdd(form)
            setForm(empty)
          }}
        >
          Add reward
        </Button>
      </div>
    </div>
  )
}
