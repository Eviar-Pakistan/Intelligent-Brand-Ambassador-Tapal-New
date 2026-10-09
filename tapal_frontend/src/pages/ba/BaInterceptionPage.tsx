import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, UserRound } from 'lucide-react'
import { ambassadors, stores } from '../../data/mock'
import { useBaShift } from '../../context/BaShiftContext'
import { useBaSession } from '../../lib/baAccounts'
import { packKgForSales, type CityReportSku } from '../../lib/baReport'
import { baCurrentStore, useCreatedStores } from '../../lib/storeRegistry'
import { portalGet } from '../../lib/serverApi'
import {
  INTERCEPTION_STATUSES,
  submitUserInterception,
  type InterceptionStatus,
  type PurchasedSkuQty,
} from '../../lib/userInterceptions'

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-[#faf6ee] px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15'

const qtyClass =
  'w-16 shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm tabular-nums text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15'

const empty = {
  status: 'productive' as InterceptionStatus,
  name: '',
  contact: '',
  cityArea: '',
  previousBrand: '',
  previousSku: '',
  feedback: '',
}

function parseQty(raw: string | undefined): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function BaInterceptionPage() {
  const navigate = useNavigate()
  const { account } = useBaSession()
  const ba = ambassadors.find((ambassador) => ambassador.id === account?.id)
  const baId = account?.id ?? ba?.id ?? 'ayesha'
  const baName = account?.name ?? ba?.name ?? 'Ayesha Khan'
  const { shiftStore } = useBaShift()
  const knownStores = useCreatedStores()
  const store = useMemo(() => {
    const own = ba?.storeId != null ? stores.find((item) => item.id === ba.storeId) : undefined
    if (own) return own
    const id = shiftStore?.id ?? baCurrentStore()
    return id != null ? stores.find((item) => item.id === id) : undefined
  }, [ba, shiftStore, knownStores])

  const [form, setForm] = useState(empty)
  /** SKU label → quantity string (empty = 0 / not purchased). */
  const [qtyBySku, setQtyBySku] = useState<Record<string, string>>({})
  const [citySkus, setCitySkus] = useState<CityReportSku[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void portalGet<{ reportSkus?: CityReportSku[] | null }>('/api/ba/me/', 'ba').then((me) => {
      if (cancelled) return
      setCitySkus(me?.reportSkus?.length ? me.reportSkus : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const skusByBrand = useMemo(() => {
    const groups = new Map<string, CityReportSku[]>()
    const seen = new Set<string>()
    for (const row of citySkus ?? []) {
      const key = row.label || row.sku
      if (!key || seen.has(key)) continue
      seen.add(key)
      groups.set(row.brand || 'Other', [...(groups.get(row.brand || 'Other') ?? []), row])
    }
    return [...groups.entries()].map(([brand, rows]) => {
      const sorted = [...rows].sort((a, b) => {
        const gramsA = packKgForSales(a.sku)
        const gramsB = packKgForSales(b.sku)
        if (gramsA !== gramsB) return gramsA - gramsB
        return (a.label || a.sku).localeCompare(b.label || b.sku, undefined, { sensitivity: 'base' })
      })
      return [brand, sorted] as [string, CityReportSku[]]
    })
  }, [citySkus])

  const purchasedSkus: PurchasedSkuQty[] = useMemo(() => {
    const out: PurchasedSkuQty[] = []
    for (const [, rows] of skusByBrand) {
      for (const row of rows) {
        const label = row.label || row.sku
        const qty = parseQty(qtyBySku[label])
        if (qty > 0) out.push({ sku: label, qty })
      }
    }
    return out
  }, [skusByBrand, qtyBySku])

  const phoneDigits = form.contact.replace(/\D/g, '')
  const nonProductive = form.status === 'non_productive'
  const canSubmit =
    nonProductive ||
    (form.name.trim() !== '' &&
      phoneDigits !== '' &&
      form.cityArea.trim() !== '' &&
      form.previousBrand.trim() !== '' &&
      form.previousSku.trim() !== '' &&
      purchasedSkus.length > 0 &&
      form.feedback.trim() !== '')

  function set(key: keyof typeof empty) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((current) => ({ ...current, [key]: event.target.value }))
      setError(null)
    }
  }

  function setQty(label: string, value: string) {
    // Digits only; blank clears.
    const cleaned = value.replace(/\D/g, '')
    setQtyBySku((current) => ({ ...current, [label]: cleaned }))
    setError(null)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) {
      setError(
        nonProductive
          ? 'Fill every field.'
          : 'Fill every field and enter quantity greater than 0 for at least one SKU.',
      )
      return
    }
    const qtys = nonProductive ? [] : purchasedSkus
    const saved = submitUserInterception({
      baId,
      baName,
      storeId: store?.id ?? null,
      storeName: store?.name ?? '',
      ...form,
      currentSku: qtys.map((row) => `${row.sku} × ${row.qty}`).join(', '),
      currentSkus: qtys.map((row) => row.sku),
      currentSkuQtys: qtys,
    })
    setSavedName(saved.name)
    setForm(empty)
    setQtyBySku({})
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-[#f7f4ec] p-4 pb-8">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => navigate('/ba/home')}
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">User interception</h1>
          <p className="mt-0.5 text-xs text-slate-500">Record the shopper you just spoke with</p>
        </div>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <UserRound size={16} className="text-brand-600" />
          <h2 className="text-sm font-bold text-navy-900">Shopper details</h2>
        </div>

        <Field label="Interception type">
          <select
            className={fieldClass}
            value={form.status}
            onChange={(e) => {
              const status = e.target.value as InterceptionStatus
              setForm((current) => ({ ...current, status }))
              if (status === 'non_productive') setQtyBySku({})
              setError(null)
            }}
          >
            {INTERCEPTION_STATUSES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input className={fieldClass} value={form.name} onChange={set('name')} placeholder="Ayesha" />
        </Field>
        <Field label="Contact">
          <input
            className={fieldClass}
            value={form.contact}
            onChange={set('contact')}
            placeholder="0346-4529909"
            inputMode="tel"
          />
        </Field>
        <Field label="City / Area">
          <input
            className={fieldClass}
            value={form.cityArea}
            onChange={set('cityArea')}
            placeholder="Wapda town / Lahore"
          />
        </Field>
        <Field label="Previous brand usership">
          <input
            className={fieldClass}
            value={form.previousBrand}
            onChange={set('previousBrand')}
            placeholder="Lipton"
          />
        </Field>
        <Field label="Previous SKU usership">
          <input
            className={fieldClass}
            value={form.previousSku}
            onChange={set('previousSku')}
            placeholder="430gm"
          />
        </Field>
        {!nonProductive && (
          <div className="mt-3">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              Current purchased SKU
              {purchasedSkus.length > 0 ? (
                <span className="ml-1 font-normal text-slate-400">
                  ({purchasedSkus.length} with qty)
                </span>
              ) : null}
            </span>
            <p className="mb-2 text-[11px] text-slate-500">Enter quantity for each SKU bought. Leave blank or 0 to skip.</p>
            {citySkus === null ? (
              <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">Loading SKUs…</p>
            ) : skusByBrand.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                No city SKUs configured for your city. Ask Head Office to add them.
              </p>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-[#faf6ee] p-3">
                {skusByBrand.map(([brand, rows]) => (
                  <div key={brand}>
                    <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                      {brand}
                    </div>
                    <ul className="space-y-1.5">
                      {rows.map((row) => {
                        const label = row.label || row.sku
                        return (
                          <li
                            key={`${brand}-${row.sku}`}
                            className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/80"
                          >
                            <span className="min-w-0 flex-1 text-sm text-slate-800">{label}</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              aria-label={`Quantity for ${label}`}
                              placeholder="0"
                              value={qtyBySku[label] ?? ''}
                              onChange={(e) => setQty(label, e.target.value)}
                              className={qtyClass}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <Field label="Feedback">
          <textarea
            className={`${fieldClass} min-h-24 resize-y`}
            value={form.feedback}
            onChange={set('feedback')}
            placeholder="Because of taste"
          />
        </Field>

        {error && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}
        {savedName && !error && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-700">
            <CheckCircle2 size={16} />
            Saved {savedName}. You can record the next shopper.
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-4 w-full rounded-2xl bg-navy-900 py-3 text-sm font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
        >
          Save interception
        </button>
      </section>
    </form>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  )
}
