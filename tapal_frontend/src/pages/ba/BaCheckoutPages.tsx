import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useBaShift } from '../../context/BaShiftContext'
import { recordEarlyCheckout } from '../../lib/earlyCheckouts'
import { useBaSession } from '../../lib/baAccounts'
import { Modal } from '../../components/ui'
import {
  clearReportDraft,
  DEFAULT_OTHER_BRANDS,
  fixedSalesSections,
  isUnitSalesKey,
  isWholeUnits,
  loadReportDraft,
  recordDailyReport,
  saveReportDraft,
  SESSION_KEYS,
  STOCK_OPTIONS,
  useReportSections,
  type FieldDef,
  type OtherBrandRow,
  type ReportSections,
} from '../../lib/baReport'
import { portalGet } from '../../lib/serverApi'

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

function CoverReportNotice({ name }: { name: string | null }) {
  if (!name) return null
  return (
    <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
      You are submitting this report for {name}. Sales and target credit will go to {name}; your attendance remains under your account.
    </p>
  )
}

function NumberField({
  label,
  value,
  onChange,
  whole = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** Units: whole numbers only, a decimal point can not be typed or pasted. */
  whole?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      <input
        type="number"
        min={0}
        step={whole ? 1 : 'any'}
        inputMode={whole ? 'numeric' : 'decimal'}
        value={value}
        onKeyDown={whole ? (e) => ['.', ',', 'e', 'E', '+', '-'].includes(e.key) && e.preventDefault() : undefined}
        onChange={(e) => onChange(whole ? e.target.value.replace(/\D/g, '') : e.target.value)}
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

/** True when every sales field is empty or 0. */
function hasNoSales(values: Record<string, string>) {
  return Object.values(values).every((value) => !(Number(value) > 0))
}

function reportPath(path: string, anytime: boolean) {
  return anytime ? `${path}?mode=anytime` : path
}

function hasFilledValues(values?: Record<string, string> | null) {
  return !!values && Object.values(values).some((v) => String(v ?? '').trim() !== '')
}

/** Checkout needs this checkout's stock report first (an anytime stock report does not count). */
function hasCheckoutStock(baId?: string) {
  if (hasFilledValues(readSession<Record<string, string>>(SESSION_KEYS.stock, {}))) return true
  if (!baId) return false
  return hasFilledValues(loadReportDraft(baId).stock)
}

function mergeFieldValues(empty: Record<string, string>, ...sources: Array<Record<string, string> | undefined>) {
  const next = { ...empty }
  for (const src of sources) {
    if (!src) continue
    for (const key of Object.keys(next)) {
      if (src[key] != null && src[key] !== '') next[key] = src[key]
    }
  }
  return next
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

function LoadingSkus() {
  return <p className="bg-[#f7f4ec] p-6 text-center text-sm text-slate-500">Loading your SKUs…</p>
}

export function BaDailySalesPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const anytime = params.get('mode') === 'anytime'
  const { account } = useBaSession()
  const baId = account?.id ?? 'ba'

  useEffect(() => {
    if (!anytime && !hasCheckoutStock(baId)) navigate('/ba/stock-report', { replace: true })
  }, [anytime, navigate, baId])

  const sections = useReportSections()
  if (!sections) return <LoadingSkus />
  return <DailySalesForm sections={sections} anytime={anytime} baId={baId} />
}

function DailySalesForm({
  sections,
  anytime,
  baId,
}: {
  sections: ReportSections
  anytime: boolean
  baId: string
}) {
  const navigate = useNavigate()
  const { city, reportingFor } = useBaShift()
  const all = [...fixedSalesSections, ...sections.skuSales]
  const [values, setValues] = useState(() => {
    const empty = emptyNumeric(all.flatMap((section) => section.fields))
    if (anytime) return empty
    const draft = loadReportDraft(baId)
    const session = readSession<Record<string, string>>(SESSION_KEYS.sales, {})
    return mergeFieldValues(empty, draft.sales, session)
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [unitError, setUnitError] = useState<string | null>(null)

  useEffect(() => {
    if (anytime) return
    saveReportDraft(baId, { sales: values })
    sessionStorage.setItem(SESSION_KEYS.sales, JSON.stringify(values))
  }, [values, baId, anytime])

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setUnitError(null)
  }

  /** Saves the form and moves on. `confirmedNoSales` records that the BA was asked and chose to continue without sales. */
  function saveAndContinue(confirmedNoSales: boolean) {
    sessionStorage.setItem(SESSION_KEYS.sales, JSON.stringify(values))
    if (confirmedNoSales) sessionStorage.setItem(SESSION_KEYS.salesSkipped, 'true')
    else sessionStorage.removeItem(SESSION_KEYS.salesSkipped)
    if (!anytime) {
      saveReportDraft(baId, { sales: values, salesSkipped: confirmedNoSales })
    }
    navigate(reportPath('/ba/other-brands', anytime))
  }

  function handleContinue(e: FormEvent) {
    e.preventDefault()
    // Units are whole packs: a decimal can not be saved.
    const bad = all
      .flatMap((section) => section.fields)
      .find((f) => isUnitSalesKey(f.key) && values[f.key] !== '' && !isWholeUnits(values[f.key] ?? ''))
    if (bad) {
      setUnitError(`${bad.label}: sales are counted in units, so enter a whole number (no decimals).`)
      return
    }
    if (hasNoSales(values)) {
      setConfirmOpen(true)
      return
    }
    saveAndContinue(false)
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
        onBack={() => navigate(reportPath('/ba/stock-report', anytime))}
      />

      <CoverReportNotice name={reportingFor} />

      {all.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.fields.map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              value={values[f.key]}
              whole={isUnitSalesKey(f.key)}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </Section>
      ))}

      {unitError && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{unitError}</p>
      )}

      <button
        type="submit"
        className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
      >
        Next · Competitor data
      </button>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Continue without sales?">
        <p className="text-sm text-slate-600">
          You have not entered any sales. Every field is empty or 0. Are you sure you want to continue without filling
          in your sales?
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => saveAndContinue(true)}
            className="w-full rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 sm:w-auto sm:px-5"
          >
            Yes, continue
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:px-5"
          >
            Back
          </button>
        </div>
      </Modal>
    </form>
  )
}

export function BaStockReportPage() {
  const [params] = useSearchParams()
  const anytime = params.get('mode') === 'anytime'
  const sections = useReportSections()
  if (!sections) return <LoadingSkus />
  return <StockReportForm sections={sections} anytime={anytime} />
}

function StockReportForm({ sections, anytime }: { sections: ReportSections; anytime: boolean }) {
  const navigate = useNavigate()
  const { city, reportingFor } = useBaShift()
  const { account } = useBaSession()
  const baId = account?.id ?? 'ba'
  const [submitted, setSubmitted] = useState(false)

  const stockFields = sections.stock.flatMap((section) => section.fields)
  const [stock, setStock] = useState(() => {
    const empty = emptyStock(stockFields)
    if (anytime) return empty
    const draft = loadReportDraft(baId)
    const session = readSession<Record<string, string>>(SESSION_KEYS.stock, {})
    return mergeFieldValues(empty, draft.stock, session)
  })

  useEffect(() => {
    if (anytime) return
    saveReportDraft(baId, { stock })
    sessionStorage.setItem(SESSION_KEYS.stock, JSON.stringify(stock))
  }, [stock, baId, anytime])

  function setField(key: string, value: string) {
    setStock((prev) => ({ ...prev, [key]: value }))
  }

  const allFilled = stockFields.every((f) => stock[f.key])

  function handleContinue(e: FormEvent) {
    e.preventDefault()
    if (!allFilled) return
    if (anytime) {
      recordDailyReport(
        { stock, sales: {}, otherBrands: [] },
        {
          baId,
          baName: account?.name ?? 'Brand Ambassador',
          city: account?.city || city,
          source: 'anytime',
        },
      )
      setSubmitted(true)
      return
    }
    sessionStorage.setItem(SESSION_KEYS.stock, JSON.stringify(stock))
    saveReportDraft(baId, { stock })
    navigate('/ba/daily-sales')
  }

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
            : 'Report step 1 of 3 · closing stock, then daily sales and competitor data'
        }
        onBack={() => navigate('/ba/home')}
      />

      <CoverReportNotice name={reportingFor} />

      {sections.stock.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.fields.map((f) => (
            <StockCheckboxes key={f.key} label={f.label} value={stock[f.key]} onChange={(v) => setField(f.key, v)} />
          ))}
        </Section>
      ))}

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
  const { submitCheckoutReport, earlyCheckoutReason, city, reportingFor } = useBaShift()
  const { account } = useBaSession()
  const baId = account?.id ?? 'ba'
  const [rows, setRows] = useState<OtherBrandRow[]>(() => {
    if (anytime) return DEFAULT_OTHER_BRANDS
    const draft = loadReportDraft(baId).otherBrands
    const session = readSession<OtherBrandRow[]>(SESSION_KEYS.otherBrands, [])
    if (session.length) return session
    if (draft?.length) return draft
    return DEFAULT_OTHER_BRANDS
  })
  const [submitted, setSubmitted] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void portalGet<{ results: Array<{ key: string; label: string; fieldType: 'text' | 'number' }> }>('/api/competitor-fields/', 'ba').then((data) => {
      if (!active || !data?.results?.length) return
      const apiRows = data.results.map((field) => ({
        id: field.key,
        name: field.label,
        price: '',
        fieldType: field.fieldType as 'text' | 'number',
      }))
      const draftRows = anytime ? [] : loadReportDraft(baId).otherBrands ?? []
      const sessionRows = anytime ? [] : readSession<OtherBrandRow[]>(SESSION_KEYS.otherBrands, [])
      const saved = sessionRows.length ? sessionRows : draftRows
      const byId = new Map(saved.map((r) => [r.id, r]))
      setRows(
        apiRows.map((r) => {
          const prev = byId.get(r.id)
          return prev ? { ...r, price: prev.price ?? '', name: prev.name || r.name } : r
        }),
      )
    })
    return () => { active = false }
  }, [baId, anytime])

  useEffect(() => {
    if (anytime) return
    saveReportDraft(baId, { otherBrands: rows })
    sessionStorage.setItem(SESSION_KEYS.otherBrands, JSON.stringify(rows))
  }, [rows, baId, anytime])

  function updateRow(id: string, patch: Partial<OtherBrandRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (sending) return
    const payload = rows.filter((r) => r.name.trim())
    sessionStorage.setItem(SESSION_KEYS.otherBrands, JSON.stringify(payload))
    const draft = loadReportDraft(baId)
    const stock = {
      ...(draft.stock ?? {}),
      ...readSession<Record<string, string>>(SESSION_KEYS.stock, {}),
    }
    const sales = {
      ...(draft.sales ?? {}),
      ...readSession<Record<string, string>>(SESSION_KEYS.sales, {}),
    }
    if (!anytime) {
      if (!hasCheckoutStock(baId)) {
        navigate('/ba/stock-report')
        return
      }
      // Report submission marks Present (and checks out if the BA has not already).
      setSending(true)
      setSendError(null)
      const problem = await submitCheckoutReport({ stock, sales, otherBrands: payload })
      setSending(false)
      if (problem) {
        setSendError(problem)
        return
      }
      if (earlyCheckoutReason) {
        recordEarlyCheckout({
          baId,
          baName: account?.name ?? 'Brand Ambassador',
          reason: earlyCheckoutReason,
        })
      }
    }
    // Only counts if the BA confirmed on the Daily Sales step and the sales are still empty or 0.
    const noSalesConfirmed =
      !anytime &&
      (readSession<boolean>(SESSION_KEYS.salesSkipped, false) === true || draft.salesSkipped === true) &&
      hasNoSales(sales)
    recordDailyReport(
      { stock, sales, otherBrands: payload },
      {
        baId,
        baName: account?.name ?? 'Brand Ambassador',
        city: account?.city || city,
        source: anytime ? 'anytime' : 'checkout',
        noSalesConfirmed,
      },
    )
    if (!anytime) {
      clearReportDraft(baId)
    }
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

      <CoverReportNotice name={reportingFor} />

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
              <span className="mb-1 block text-xs font-semibold text-slate-600">{row.fieldType === 'text' ? 'Details' : 'Price / value'}</span>
              <input
                type={row.fieldType ?? 'number'}
                min={row.fieldType === 'text' ? undefined : 0}
                inputMode={row.fieldType === 'text' ? 'text' : 'decimal'}
                value={row.price}
                onChange={(e) => updateRow(row.id, { price: e.target.value })}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>
          </div>
        ))}
      </Section>

      {sendError && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{sendError}</p>
      )}
      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:opacity-60"
      >
        {sending ? 'Submitting…' : anytime ? 'Submit report' : 'Submit report & check out'}
      </button>
    </form>
  )
}
