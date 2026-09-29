import { useEffect, useState } from 'react'
import { Footprints } from 'lucide-react'
import { portalFetch } from '../lib/serverApi'

/** The BA enters how many shoppers walked into their store today (used for engagement %). */
export function BaFootfallCard() {
  const [store, setStore] = useState<{ storeName: string; todayFootfall: number } | null>(null)
  const [count, setCount] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void portalFetch('/api/ba/footfall/', {}, 'ba')
      .then(async (r) => (r && r.ok ? ((await r.json()) as { storeName: string; todayFootfall: number }) : null))
      .then((data) => {
        if (cancelled || !data) return
        setStore(data)
        if (data.todayFootfall) setCount(String(data.todayFootfall))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Only BAs with a store today (real accounts) see this.
  if (!store) return null

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await portalFetch(
        '/api/ba/footfall/',
        { method: 'POST', body: JSON.stringify({ count: Number(count) }) },
        'ba',
      )
      const data = (await response?.json().catch(() => ({}))) as { detail?: string; todayFootfall?: number }
      if (!response?.ok) throw new Error(data.detail || 'Footfall could not be saved.')
      setStore((prev) => prev && { ...prev, todayFootfall: data.todayFootfall ?? Number(count) })
      setMessage({ ok: true, text: 'Saved for today.' })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Footfall could not be saved.' })
    }
    setBusy(false)
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex items-center gap-2">
        <Footprints size={18} className="text-brand-600" />
        <h3 className="text-sm font-bold text-slate-900">Today&apos;s footfall</h3>
      </div>
      <p className="mt-1 text-xs text-slate-500">How many shoppers came into {store.storeName} today?</p>
      <div className="mt-3 flex gap-2">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-[#faf6ee] px-3 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="button"
          disabled={busy || count === ''}
          onClick={() => void save()}
          className="shrink-0 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs ${message.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p>
      )}
    </div>
  )
}
