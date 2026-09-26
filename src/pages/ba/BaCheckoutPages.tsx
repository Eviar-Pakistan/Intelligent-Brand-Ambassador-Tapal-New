import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useBaShift } from '../../context/BaShiftContext'
import { ambassadors, stores } from '../../data/mock'
import { notifyBaCheckOut } from '../../lib/supervisorNotifications'
import { useBaSession } from '../../lib/baAccounts'
import {
  competitiveFields,
  danedarSalesFields,
  DEFAULT_OTHER_BRANDS,
  interceptionFields,
  hasAnytimeStockSubmitted,
  recordDailyReport,
  SESSION_KEYS,
  useDailyReports,
  specialtySalesFields,
  STOCK_OPTIONS,
  stockDanedarFields,
  stockTeaBagFields,
  teaBagSalesFields,
  whyNotFields,
  type FieldDef,
  type OtherBrandRow,
} from '../../lib/baReport'

function emptyNumeric(fields: FieldDef[]) {
  return Object.fromEntries(fields.map((f) => [f.key, ''])) as Record<string, string>
}

function emptyStock(fields: FieldDef[]) {
  return Object.fromEntries(fields.map((f) => [f.key, ''])) as Record<string, string>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-navy-900">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full rounded-xl border border-slate-200 bg-[#faf6ee] px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15"
      />
    </label>
  )
}

function StockCheckboxes({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-[#faf6ee] px-3 py-3">
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      <div className="mt-2.5 flex flex-col gap-2.5">
        {STOCK_OPTIONS.map((opt) => {
          const checked = value === opt
          return (
            <label key={opt} className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked ? '' : opt)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 accent-brand-600 focus:ring-brand-500/30"
              />
              <span className={checked ? 'font-semibold text-brand-700' : 'font-medium'}>{opt}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function reportPath(path: string, anytime: boolean) {
  return anytime ? `${path}?mode=anytime` : path
}

function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function PageChrome({
  title,
  subtitle,
  onBack,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
      )}
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
    </div>
  )
}

export function BaDailySalesPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const anytime = params.get('mode') === 'anytime'
  const { city } = useBaShift()
  const { account } = useBaSession()
  const reports = useDailyReports()
  const stockAlreadySubmitted = hasAnytimeStockSubmitted(account?.id ?? 'ba', reports)

  const allFields = useMemo(
    () => [
      ...interceptionFields,
      ...competitiveFields,
      ...whyNotFields,
      ...danedarSalesFields,
      ...teaBagSalesFields,
      ...specialtySalesFields,
    ],
    [],
  )

  const [values, setValues] = useState(() => emptyNumeric(allFields))

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function handleContinue(e: FormEvent) {
    e.preventDefault()
    sessionStorage.setItem(SESSION_KEYS.sales, JSON.stringify(values))
    navigate(reportPath('/ba/other-brands', anytime))
  }

  return (
    <form onSubmit={handleContinue} className="space-y-4 bg-[#f7f4ec] p-4 pb-8">
      <PageChrome
        title="Daily Sales"
        subtitle={
          anytime
            ? `${city} · submit today's sales anytime`
            : `${city} · enter today's interceptions & SKU sales`
        }
        onBack={() =>
          navigate(
            !anytime && stockAlreadySubmitted ? '/ba/home' : reportPath('/ba/stock-report', anytime),
          )
        }
      />

      <Section title="Interceptions">
        {interceptionFields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <Section title="Competitive User">
        {competitiveFields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <Section title="Why Not Tapal">
        {whyNotFields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <Section title="Tapal Danedar">
        {danedarSalesFields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <Section title="Tea Bags">
        {teaBagSalesFields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <Section title="Specialty">
        {specialtySalesFields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={values[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <button
        type="submit"
        className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
      >
        Next · Competitor data
      </button>
    </form>
  )
}

export function BaStockReportPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const anytime = params.get('mode') === 'anytime'
  const { checkOut, city } = useBaShift()
  const { account } = useBaSession()
  const reports = useDailyReports()
  const stockAlreadySubmitted = hasAnytimeStockSubmitted(account?.id ?? 'ba', reports)
  const [submitted, setSubmitted] = useState(false)

  function finishCheckOut() {
    checkOut()
    const ambassador = ambassadors.find((item) => item.id === (account?.id ?? 'ayesha'))
    const store = ambassador?.storeId != null ? stores.find((item) => item.id === ambassador.storeId) : undefined
    if (ambassador?.storeId != null && store) {
      notifyBaCheckOut({
        baName: account?.name ?? ambassador.name,
        storeId: store.id,
        storeName: store.name,
        at: new Date(),
      })
    }
  }

  useEffect(() => {
    if (anytime || !stockAlreadySubmitted) return
    finishCheckOut()
    navigate('/ba/daily-sales', { replace: true })
  }, [anytime, stockAlreadySubmitted, checkOut, navigate])

  const [stock, setStock] = useState(() =>
    emptyStock([...stockDanedarFields, ...stockTeaBagFields]),
  )

  function setField(key: string, value: string) {
    setStock((prev) => ({ ...prev, [key]: value }))
  }

  const allFilled = [...stockDanedarFields, ...stockTeaBagFields].every((f) => stock[f.key])

  function handleContinue(e: FormEvent) {
    e.preventDefault()
    if (!allFilled) return
    sessionStorage.setItem(SESSION_KEYS.stock, JSON.stringify(stock))
    if (anytime) {
      recordDailyReport(
        { stock, sales: {}, otherBrands: [] },
        {
          baId: account?.id ?? 'ba',
          baName: account?.name ?? 'Brand Ambassador',
          city: account?.city || city,
          source: 'anytime',
        },
      )
      setSubmitted(true)
      return
    }
    finishCheckOut()
    navigate('/ba/daily-sales')
  }

  if (!anytime && stockAlreadySubmitted) return null

  if (submitted) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#f7f4ec] p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <CheckCircle2 size={36} />
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Stock report submitted</h2>
        <p className="mt-2 max-w-xs text-sm text-slate-500">
          Only the stock report was sent. Daily sales and competitor data are collected at checkout.
        </p>
        <button
          type="button"
          onClick={() => navigate('/ba/home')}
          className="mt-6 w-full max-w-xs rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
        >
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleContinue} className="space-y-4 bg-[#f7f4ec] p-4 pb-8">
      <PageChrome
        title="Stock Report"
        subtitle={
          anytime
            ? 'Anytime submission is stock only'
            : 'Then daily sales and competitor data'
        }
        onBack={() => navigate('/ba/home')}
      />

      <Section title="Tapal Danedar">
        {stockDanedarFields.map((f) => (
          <StockCheckboxes
            key={f.key}
            label={f.label}
            value={stock[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <Section title="Tea Bags & Specialty">
        {stockTeaBagFields.map((f) => (
          <StockCheckboxes
            key={f.key}
            label={f.label}
            value={stock[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Section>

      <button
        type="submit"
        disabled={!allFilled}
        className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {anytime ? 'Submit stock report' : 'Next · Daily Sales'}
      </button>
    </form>
  )
}

export function BaOtherBrandsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const anytime = params.get('mode') === 'anytime'
  const { markReportSubmitted, city } = useBaShift()
  const { account } = useBaSession()
  const [rows, setRows] = useState<OtherBrandRow[]>(DEFAULT_OTHER_BRANDS)
  const [submitted, setSubmitted] = useState(false)

  function updateRow(id: string, patch: Partial<OtherBrandRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = rows.filter((r) => r.name.trim())
    sessionStorage.setItem(SESSION_KEYS.otherBrands, JSON.stringify(payload))
    const stock = readSession<Record<string, string>>(SESSION_KEYS.stock, {})
    const sales = readSession<Record<string, string>>(SESSION_KEYS.sales, {})
    recordDailyReport(
      { stock, sales, otherBrands: payload },
      {
        baId: account?.id ?? 'ba',
        baName: account?.name ?? 'Brand Ambassador',
        city: account?.city || city,
        source: anytime ? 'anytime' : 'checkout',
      },
    )
    if (!anytime) markReportSubmitted()
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#f7f4ec] p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <CheckCircle2 size={36} />
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Your Data has been Submitted</h2>
        <p className="mt-2 max-w-xs text-sm text-slate-500">
          Stock and daily sales were sent to the dashboard. Competitor prices are included only if you entered them.
        </p>
        <button
          type="button"
          onClick={() => navigate('/ba/home')}
          className="mt-6 w-full max-w-xs rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
        >
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-[#f7f4ec] p-4 pb-8">
      <PageChrome
        title="Competitor data"
        subtitle="Optional. Leave prices blank if you do not have competitor prices."
        onBack={() => navigate(reportPath('/ba/daily-sales', anytime))}
      />

      <Section title="Competitor prices">
        {rows.map((row, index) => (
          <div
            key={row.id}
            className="rounded-xl border border-slate-100 bg-[#faf6ee] p-3 space-y-2.5"
          >
            <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Brand {index + 1}
            </span>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">
                Brand / pack name
              </span>
              <input
                type="text"
                value={row.name}
                disabled
                readOnly
                className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Price (Rs.)</span>
              <input
                type="number"
                min={0}
                inputMode="decimal"
                value={row.price}
                onChange={(e) => updateRow(row.id, { price: e.target.value })}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>
          </div>
        ))}
      </Section>

      <button
        type="submit"
        className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
      >
        Submit report
      </button>
    </form>
  )
}
