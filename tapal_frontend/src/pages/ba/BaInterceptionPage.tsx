import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, UserRound } from 'lucide-react'
import { ambassadors, stores } from '../../data/mock'
import { useBaShift } from '../../context/BaShiftContext'
import { useBaSession } from '../../lib/baAccounts'
import { baCurrentStore, useCreatedStores } from '../../lib/storeRegistry'
import {
  INTERCEPTION_STATUSES,
  submitUserInterception,
  type InterceptionStatus,
} from '../../lib/userInterceptions'

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-[#faf6ee] px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15'

const empty = {
  status: 'productive' as InterceptionStatus,
  name: '',
  contact: '',
  cityArea: '',
  previousBrand: '',
  previousSku: '',
  currentSku: '',
  feedback: '',
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
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)

  const phoneDigits = form.contact.replace(/\D/g, '')
  const nonProductive = form.status === 'non_productive'
  // Every field just needs something in it — no minimum length. A non-productive interception has no
  // required fields (and no purchased SKU).
  const canSubmit =
    nonProductive ||
    (form.name.trim() !== '' &&
    phoneDigits !== '' &&
    form.cityArea.trim() !== '' &&
    form.previousBrand.trim() !== '' &&
    form.previousSku.trim() !== '' &&
    form.currentSku.trim() !== '' &&
    form.feedback.trim() !== '')

  function set(key: keyof typeof empty) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((current) => ({ ...current, [key]: event.target.value }))
      setError(null)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) {
      setError('Fill every field.')
      return
    }
    const saved = submitUserInterception({
      baId,
      baName,
      storeId: store?.id ?? null,
      storeName: store?.name ?? '',
      ...form,
      currentSku: nonProductive ? '' : form.currentSku,
    })
    setSavedName(saved.name)
    setForm(empty)
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
          <select className={fieldClass} value={form.status} onChange={set('status')}>
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
          <Field label="Current purchased SKU">
            <input
              className={fieldClass}
              value={form.currentSku}
              onChange={set('currentSku')}
              placeholder="Tapal Danedar 430gm"
            />
          </Field>
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
