import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Avatar, Button, Card, ProgressRing, ScoreBars, StatusBadge } from '../../components/ui'
import { serverAmbassadorId } from '../../context/ScheduleContext'
import type { BaAccount } from '../../lib/baAccounts'
import { djangoFetch, djangoToken } from '../../lib/djangoApi'
import { useCreatedStores } from '../../lib/storeRegistry'

const LIFECYCLE = ['Recruited', 'AI Screened', 'Certified', 'Trained', 'Deployed', 'Live'] as const

/** Lifecycle steps reached, from the server status (Live = on shift right now). */
function lifecycleFor(serverStatus: string | undefined, onShift: boolean): string[] {
  const done = ['Recruited']
  if (['Assessed', 'Certified', 'Deployed', 'Rejected'].includes(serverStatus ?? '')) done.push('AI Screened')
  if (serverStatus === 'Certified' || serverStatus === 'Deployed') done.push('Certified', 'Trained')
  if (serverStatus === 'Deployed') done.push('Deployed')
  if (onShift) done.push('Live')
  return done
}

type Standing = { rank: number; points: number; conversion: number; interactions: number } | null

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500'

async function request(path: string, init: RequestInit) {
  if (!djangoToken()) throw new Error('Sign in to Head Office to continue.')
  const response = await djangoFetch(path, init)
  const data = (await response.json().catch(() => ({}))) as { detail?: string }
  if (!response.ok) throw new Error(data.detail || 'The change could not be saved.')
  const { syncDjango } = await import('../../lib/djangoSync')
  await syncDjango()
}

/** Profile of a real (server) ambassador: assessment, lifecycle, performance, store and account admin. */
export function AmbassadorProfile({ account, onShiftToday }: { account: BaAccount; onShiftToday: boolean }) {
  const serverId = serverAmbassadorId(account.id)
  const stores = useCreatedStores()
  const [standing, setStanding] = useState<Standing>(null)
  const [storeId, setStoreId] = useState(account.storeId ? String(account.storeId) : '')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: account.name, city: account.city, email: account.email, phone: account.phone })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const active = account.isActive !== false

  useEffect(() => {
    if (serverId === null || !djangoToken()) return
    let cancelled = false
    djangoFetch('/api/intelligence/leaderboard/')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { results?: (NonNullable<Standing> & { id: number })[] } | null) => {
        const row = data?.results?.find((item) => item.id === serverId)
        if (!cancelled) setStanding(row ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [serverId])

  const result = account.result
  const lifecycle = useMemo(() => lifecycleFor(account.serverStatus, onShiftToday), [account.serverStatus, onShiftToday])
  const current = lifecycle[lifecycle.length - 1]

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage({ ok: true, text: success })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'The change could not be saved.' })
    }
    setBusy(false)
  }

  const patch = (body: object) =>
    request(`/api/ambassadors/${serverId}/`, { method: 'PATCH', body: JSON.stringify(body) })

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit lg:sticky lg:top-4">
        <div className="flex flex-col items-center text-center">
          <Avatar name={account.name} size="lg" />
          <h2 className="mt-3 text-lg font-bold text-slate-900">{account.name}</h2>
          <div className="mt-1 font-mono text-xs text-slate-500">{account.baCode || '—'}</div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <StatusBadge status={account.serverStatus || account.status} />
            {!active && <StatusBadge status="Inactive" />}
            {account.isBackup && <StatusBadge status="Backup BA" />}
          </div>
          <p className="mt-2 text-xs text-slate-500">{account.city || '—'}</p>
          <p className="mt-0.5 text-sm text-slate-600">{account.storeName || 'No store yet'}</p>
          <div className="mt-5">
            <ProgressRing value={result ? Math.round(result.quality) : 0} size={120} stroke={9} label="Assessment" />
          </div>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          {result ? (
            <>
              <ScoreBars
                rows={[
                  { label: 'Overall quality', value: Math.round(result.quality) },
                  { label: 'Communication', value: Math.round(result.communication) },
                  { label: 'Question relevance', value: Math.round(result.relevance) },
                  { label: 'Training alignment', value: Math.round(result.alignment) },
                  { label: 'Confidence', value: Math.max(0, Math.round(100 - result.nervousness)) },
                ]}
              />
              <p className="mt-3 text-xs text-slate-500">
                {Math.round(result.wpm)} words/min · mood {result.mood} ·{' '}
                {result.certified ? 'passed' : 'not passed yet'}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Not assessed yet.</p>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Mini label="Conv. rate" value={standing ? `${standing.conversion}%` : '—'} />
          <Mini label="Rank" value={standing ? `#${standing.rank}` : '—'} />
          <Mini label="Points" value={standing ? standing.points.toLocaleString() : '—'} />
        </div>
        {!standing && (
          <p className="-mt-2 text-xs text-slate-400">Not on the leaderboard (deactivated or not loaded yet).</p>
        )}

        <Card>
          <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Lifecycle</div>
          <ol className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {LIFECYCLE.map((stage, i) => {
              const done = lifecycle.includes(stage)
              return (
                <li
                  key={stage}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] sm:text-xs ${
                    current === stage
                      ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-200'
                      : done
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-slate-50 text-slate-400'
                  }`}
                >
                  {done ? (
                    <Check size={12} className="shrink-0" />
                  ) : (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300" />
                  )}
                  <span className="truncate">
                    {i + 1}. {stage}
                  </span>
                </li>
              )
            })}
          </ol>
        </Card>

        <Card>
          <div className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Deploy to store</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={fieldClass}>
              <option value="">Choose a store…</option>
              {[...stores]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.storeCode ? `${s.storeCode} · ` : ''}
                    {s.name} ({s.city})
                  </option>
                ))}
            </select>
            <Button
              className="shrink-0"
              disabled={busy || !storeId || !active || String(account.storeId ?? '') === storeId}
              onClick={() =>
                void run(
                  () =>
                    request(`/api/ambassadors/${serverId}/deploy/`, {
                      method: 'POST',
                      body: JSON.stringify({ store_id: Number(storeId) }),
                    }),
                  'Deployed to the store.',
                )
              }
            >
              Deploy
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Only certified ambassadors can be deployed.</p>
          {serverId !== null && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div>
                <div className="text-sm font-medium text-slate-800">Backup BA pool</div>
                <div className="text-xs text-slate-500">Allow Head Office to assign this BA as shift cover.</div>
              </div>
              <Button
                size="sm"
                variant={account.isBackup ? 'secondary' : 'primary'}
                disabled={busy || !active || account.isDemoAccount}
                onClick={() =>
                  void run(
                    () => patch({ is_backup: !account.isBackup }),
                    account.isBackup ? 'Removed from the backup pool.' : 'Added to the backup pool.',
                  )
                }
              >
                {account.isBackup ? 'Remove' : 'Add'}
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Account</div>
            {!editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit details
              </Button>
            )}
          </div>
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(['name', 'city', 'email', 'phone'] as const).map((key) => (
                <label key={key} className="block text-sm">
                  <span className="mb-1 block font-medium capitalize text-slate-700">
                    {key}
                    {key === 'name' ? ' *' : ''}
                  </span>
                  <input
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className={fieldClass}
                  />
                </label>
              ))}
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  disabled={busy || !form.name.trim()}
                  onClick={() =>
                    void run(async () => {
                      await patch(form)
                      setEditing(false)
                    }, 'Details saved.')
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
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Email" value={account.email} />
              <Row label="Phone" value={account.phone} />
            </dl>
          )}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs text-slate-500">
              {active
                ? 'Deactivating stops the account link, check-in and new shifts. History is kept.'
                : 'This BA is deactivated: the account link does not open and they get no new shifts.'}
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (active && !window.confirm(`Deactivate ${account.name}?`)) return
                void run(() => patch({ is_active: !active }), active ? 'Ambassador deactivated.' : 'Ambassador reactivated.')
              }}
            >
              {active ? 'Deactivate ambassador' : 'Reactivate ambassador'}
            </Button>
          </div>
        </Card>

        {serverId !== null && <RetrainingCard serverId={serverId} />}

        {message && (
          <p
            className={`rounded-xl border px-3 py-2 text-sm ${
              message.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 text-center shadow-sm">
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value || '—'}</dd>
    </div>
  )
}

type Practice = { id: number; kind: 'video' | 'scenario'; title: string; question: string; answer: string; createdAt: string }

/** Answers the BA gave while retraining in the app (training video questions and practice scenarios). */
function RetrainingCard({ serverId }: { serverId: number }) {
  const [rows, setRows] = useState<Practice[] | null>(null)
  useEffect(() => {
    if (!djangoToken()) return
    let cancelled = false
    djangoFetch(`/api/ba/training/practice/?ambassador=${serverId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { results?: Practice[] } | null) => {
        if (!cancelled) setRows(data?.results ?? [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [serverId])

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Retraining</div>
        {rows && <span className="text-xs text-slate-400">{rows.length} answers</span>}
      </div>
      {!rows ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No retraining answers yet.</p>
      ) : (
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {rows.map((p) => (
            <li key={p.id} className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">
                  {p.kind === 'video' ? 'Video' : 'Scenario'} · {p.title || '—'}
                </span>
                <span>
                  {new Date(p.createdAt).toLocaleString('en-PK', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: 'Asia/Karachi',
                  })}
                </span>
              </div>
              <div className="mt-1 font-medium text-slate-900">{p.question}</div>
              <p className="mt-1 text-slate-700">{p.answer}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

