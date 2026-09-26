import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CloudSun,
  Download,
  FileSpreadsheet,
  MapPin,
  Trophy,
  Upload,
  UserRound,
} from 'lucide-react'
import { buildIncentiveRoster, formatPkr } from '../../lib/incentives'
import {
  achievementPct,
  currentMonthKey,
  formatTargetMonth,
  targetForBa,
  useBaTargets,
} from '../../lib/baTargets'
import { useBrand } from '../../context/BrandContext'
import { formatDate, formatTime, useBaShift } from '../../context/BaShiftContext'
import { useTrainingContent } from '../../context/TrainingContentContext'
import {
  downloadBaReportTemplate,
  hasAnytimeStockSubmitted,
  parseBaReportFile,
  recordDailyReport,
  saveBaReport,
  useDailyReports,
} from '../../lib/baReport'
import { FaceCheckInModal } from '../../components/FaceCheckInModal'
import { Modal } from '../../components/ui'
import { useBaSession } from '../../lib/baAccounts'
import { ambassadors, stores } from '../../data/mock'
import { notifyBaCheckIn, notifyBaCheckOut } from '../../lib/supervisorNotifications'
import { useUserInterceptions } from '../../lib/userInterceptions'
import { BaOnboarding } from './BaOnboarding'

function greetingFor(hour: number) {
  if (hour < 12) return 'Good Morning'
  if (hour < 17) return 'Good Afternoon'
  return 'Good Evening'
}

function weatherLabel(code: number) {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Partly cloudy'
  if (code <= 48) return 'Foggy'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  return 'Stormy'
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

export function BaHomePage() {
  const { brand } = useBrand()
  const { account } = useBaSession()
  const baName = account?.name ?? 'Brand Ambassador'
  const navigate = useNavigate()
  const {
    city,
    shiftLabel,
    shiftEndLabel,
    checkedIn,
    checkInAt,
    canCheckOut,
    reportSubmitted,
    isEarlyCheckout,
    checkIn,
    checkOut,
    setEarlyCheckoutReason,
    markReportSubmitted,
  } = useBaShift()

  const [now, setNow] = useState(() => new Date())
  const [tempC, setTempC] = useState<string | null>(null)
  const [weatherText, setWeatherText] = useState('Loading…')
  const [faceCheckOpen, setFaceCheckOpen] = useState(false)
  const [checkoutWarningOpen, setCheckoutWarningOpen] = useState(false)
  const [earlyReasonOpen, setEarlyReasonOpen] = useState(false)
  const [earlyReason, setEarlyReason] = useState('')
  const [excelFileName, setExcelFileName] = useState<string | null>(null)
  const [excelErrors, setExcelErrors] = useState<string[]>([])
  const [excelBusy, setExcelBusy] = useState(false)
  const excelInputRef = useRef<HTMLInputElement>(null)
  const reports = useDailyReports()
  const interceptions = useUserInterceptions()
  const baId = account?.id ?? 'ba'
  const stockAlreadySubmitted = hasAnytimeStockSubmitted(baId, reports)
  const interceptionsToday = interceptions.filter(
    (row) => row.baId === baId && new Date(row.createdAt).toDateString() === now.toDateString(),
  ).length

  async function saveExcelUpload(file: File | undefined) {
    if (!file) return
    setExcelBusy(true)
    const result = await parseBaReportFile(file)
    setExcelBusy(false)
    if ('errors' in result) {
      setExcelErrors(result.errors)
      return
    }
    setExcelErrors([])
    setExcelFileName(file.name)
    saveBaReport(result.data, file.name)
    recordDailyReport(result.data, {
      baId,
      baName,
      city,
      source: 'excel',
    })
    if (!reportSubmitted) {
      checkOut()
      markReportSubmitted()
      const ambassador = ambassadors.find((a) => a.id === baId)
      const store = ambassador?.storeId != null ? stores.find((s) => s.id === ambassador.storeId) : undefined
      if (ambassador?.storeId != null && store) {
        notifyBaCheckOut({
          baName,
          storeId: store.id,
          storeName: store.name,
          at: new Date(),
        })
      }
    }
  }

  function handleCheckOutClick() {
    if (isEarlyCheckout) {
      setEarlyReason('')
      setEarlyReasonOpen(true)
      return
    }
    setCheckoutWarningOpen(true)
  }

  function submitEarlyReason() {
    const reason = earlyReason.trim()
    if (reason.length < 8) return
    setEarlyCheckoutReason(reason)
    setEarlyReasonOpen(false)
    setCheckoutWarningOpen(true)
  }

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadWeather() {
      try {
        // Lahore coords — Open-Meteo (no API key)
        const url =
          'https://api.open-meteo.com/v1/forecast?latitude=31.5204&longitude=74.3587&current=temperature_2m,weather_code'
        const res = await fetch(url)
        if (!res.ok) throw new Error('weather failed')
        const data = await res.json()
        if (cancelled) return
        const t = data?.current?.temperature_2m
        const code = Number(data?.current?.weather_code ?? 0)
        setTempC(typeof t === 'number' ? String(Math.round(t)) : null)
        setWeatherText(weatherLabel(code))
      } catch {
        if (!cancelled) {
          setTempC('32')
          setWeatherText('Clear')
        }
      }
    }
    void loadWeather()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-4 bg-[#f7f4ec] p-4 pb-6">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 sm:p-5">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#faf6ee] p-3.5">
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Date
            </div>
            <div className="mt-1 text-base font-bold leading-snug text-slate-900 sm:text-lg">
              {formatDate(now)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Time
            </div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums leading-snug text-navy-900 sm:text-lg">
              {formatTime(now)}
            </div>
          </div>
          <div className="col-span-2 h-px bg-slate-200/70" />
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <MapPin size={20} />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                City
              </div>
              <div className="truncate text-lg font-bold text-slate-900">{city}</div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2.5">
            <div className="min-w-0 text-right">
              <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Weather
              </div>
              <div className="text-lg font-bold text-slate-900">
                {tempC ? `${tempC}°C` : '—'}
              </div>
              <div className="text-sm font-medium text-slate-600">{weatherText}</div>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-gold-600">
              <CloudSun size={20} />
            </span>
          </div>
        </div>

        <p className="mt-4 text-base text-slate-500">{greetingFor(now.getHours())}</p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{baName} 👋</h2>
            <p className="mt-1 text-base font-semibold text-brand-600">A+ Certified</p>
          </div>
          <Link
            to="/ba/performance"
            className="flex shrink-0 items-center gap-0.5 pt-1.5 text-sm font-semibold text-brand-600"
          >
            View Profile
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>



      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <h3 className="text-sm font-bold text-slate-900">Today&apos;s Shift</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-100 to-brand-200 text-sm font-bold text-brand-700 ring-2 ring-white">
            {initialsOf(baName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900">Store #12, {city}</div>
            <div className="text-sm text-slate-500">{shiftLabel}</div>
          </div>
          {!checkedIn ? (
            <button
              type="button"
              onClick={() => setFaceCheckOpen(true)}
              className="shrink-0 rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
            >
              Check In
            </button>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
              <CheckCircle2 size={14} />
              Checked In
            </span>
          )}
        </div>

        {checkedIn && checkInAt && (
          <div className="mt-3 rounded-xl bg-[#faf6ee] px-3 py-2.5 text-sm text-slate-700">
            <span className="font-medium text-slate-500">Check-in time</span>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">
              {formatTime(checkInAt)}
            </div>
          </div>
        )}

        {checkedIn && !reportSubmitted && (
          <>
            <button
              type="button"
              disabled={!canCheckOut}
              onClick={handleCheckOutClick}
              className="mt-3 w-full rounded-2xl bg-navy-900 py-3 text-sm font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
            >
              Check Out
            </button>
            {!canCheckOut && (
              <p className="mt-2 text-center text-xs text-slate-500">
                Check Out enables 10 seconds after check-in
              </p>
            )}
            {canCheckOut && isEarlyCheckout && (
              <p className="mt-2 text-center text-xs text-amber-700">
                Shift ends at {shiftEndLabel}. Early checkout requires a reason.
              </p>
            )}
          </>
        )}

        {reportSubmitted && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-700">
            <CheckCircle2 size={16} />
            Today&apos;s report submitted
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-2">
          <UserRound size={18} className="text-brand-600" />
          <h3 className="text-sm font-bold text-slate-900">User interception</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Record a shopper’s name, contact, previous brand and SKU, the SKU they bought, and their feedback.
        </p>
        <Link
          to="/ba/interception"
          className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-navy-900 py-3 text-sm font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
        >
          User interception form
        </Link>
        {interceptionsToday > 0 && (
          <p className="mt-2 text-center text-xs font-semibold text-brand-700">
            {interceptionsToday} recorded today
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-brand-600" />
          <h3 className="text-sm font-bold text-slate-900">Stock report</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {stockAlreadySubmitted
            ? 'Today’s stock report is already submitted. Checkout will start with daily sales.'
            : 'Submit stock at any time. Daily sales and competitor data are collected at checkout.'}
        </p>
        {stockAlreadySubmitted ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-700">
            <CheckCircle2 size={16} />
            Stock report submitted
          </div>
        ) : (
          <Link
            to="/ba/stock-report?mode=anytime"
            className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-navy-900 py-3 text-sm font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
          >
            Submit stock report
          </Link>
        )}
      </div>

      {checkedIn && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-brand-600" />
            <h3 className="text-sm font-bold text-slate-900">Upload Excel report</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            One file for Stock Report, Daily Sales, and Other Brands (.xlsx / .xls / .csv)
          </p>
          <button
            type="button"
            onClick={() => void downloadBaReportTemplate()}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
          >
            <Download size={14} />
            Download Excel template
          </button>
          <p className="mt-1.5 text-center text-[11px] text-slate-400">
            Fill in the template, then upload it below
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-100 bg-[#faf6ee] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">Daily report file</div>
              <div className="truncate text-xs text-slate-500">
                {excelFileName ? `Uploaded: ${excelFileName}` : 'No file selected'}
              </div>
            </div>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="hidden"
              onChange={(e) => {
                saveExcelUpload(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={excelBusy}
              onClick={() => excelInputRef.current?.click()}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45"
            >
              <Upload size={12} />
              {excelBusy ? 'Checking…' : excelFileName ? 'Replace' : 'Upload'}
            </button>
          </div>
          {excelErrors.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <div className="font-semibold">
                Report not submitted — please fix {excelErrors.length}{' '}
                {excelErrors.length === 1 ? 'issue' : 'issues'} and upload again:
              </div>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {excelErrors.slice(0, 8).map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
              {excelErrors.length > 8 && (
                <div className="mt-1 font-medium">…and {excelErrors.length - 8} more</div>
              )}
            </div>
          )}
          {excelFileName ? (
            <p className="mt-3 text-center text-xs font-semibold text-brand-700">
              Report file uploaded
            </p>
          ) : (
            <p className="mt-3 text-center text-xs text-slate-500">
              Or check out and fill reports manually
            </p>
          )}
        </div>
      )}

      <FaceCheckInModal
        open={faceCheckOpen}
        onClose={() => setFaceCheckOpen(false)}
        onConfirmed={() => {
          checkIn()
          const ambassador = ambassadors.find((a) => a.id === (account?.id ?? 'ayesha'))
          const store = ambassador?.storeId != null ? stores.find((s) => s.id === ambassador.storeId) : undefined
          if (ambassador?.storeId != null && store) {
            notifyBaCheckIn({
              baName: account?.name ?? ambassador.name,
              storeId: store.id,
              storeName: store.name,
              at: new Date(),
            })
          }
          setFaceCheckOpen(false)
        }}
      />

      <Modal
        open={earlyReasonOpen}
        onClose={() => setEarlyReasonOpen(false)}
        title="Early check-out"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={22} />
            <p className="text-sm leading-relaxed text-slate-800">
              Your shift ends at <span className="font-semibold">{shiftEndLabel}</span>. You are
              checking out early — please enter a reason to continue.
            </p>
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Reason for early check-out</span>
            <textarea
              value={earlyReason}
              onChange={(e) => setEarlyReason(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              placeholder="e.g. Store closed early / Manager approved leave / Feeling unwell…"
            />
          </label>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
            <button
              type="button"
              disabled={earlyReason.trim().length < 8}
              onClick={submitEarlyReason}
              className="w-full rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-5"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => setEarlyReasonOpen(false)}
              className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:px-5"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={checkoutWarningOpen}
        onClose={() => setCheckoutWarningOpen(false)}
        title="Complete your reports"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={22} />
            <p className="text-sm leading-relaxed text-slate-800">
              {stockAlreadySubmitted ? (
                <>
                  Stock is already submitted. Checkout continues with{' '}
                  <span className="font-semibold">Daily Sales</span> and{' '}
                  <span className="font-semibold">Competitor data</span>. Competitor prices are optional.
                </>
              ) : (
                <>
                  Checkout includes the <span className="font-semibold">Stock Report</span>,{' '}
                  <span className="font-semibold">Daily Sales</span>, and{' '}
                  <span className="font-semibold">Competitor data</span>. Competitor prices are optional.
                </>
              )}
            </p>
          </div>
          <p className="text-sm leading-relaxed text-slate-600">
            If these reports are not submitted, your attendance for today will be marked as{' '}
            <span className="font-bold text-red-600">Absent</span>.
          </p>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
            <button
              type="button"
              onClick={() => {
                setCheckoutWarningOpen(false)
                if (stockAlreadySubmitted) {
                  checkOut()
                  navigate('/ba/daily-sales')
                  return
                }
                navigate('/ba/stock-report')
              }}
              className="w-full rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 sm:w-auto sm:px-5"
            >
              Continue to reports
            </button>
            <button
              type="button"
              onClick={() => setCheckoutWarningOpen(false)}
              className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:px-5"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <h3 className="text-sm font-bold text-slate-900">Today&apos;s Goals</h3>
        <div className="mt-4 grid grid-cols-3 gap-1.5 text-center sm:gap-2">
          <BaGoalStat label="Engagement" value="25/30" />
          <BaGoalStat label="Conversions" value="80%" />
          <BaGoalStat label="Conversations" value="40/50" />
        </div>
        <div className="mt-5 flex items-end justify-around gap-3">
          {brand.baGoalProducts.map((product, index) => (
            <div
              key={`${product.alt}-${index}`}
              className="flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-full bg-[#f7f4ec] p-1.5 shadow-inner"
            >
              <img
                src={product.src}
                alt={product.alt}
                className="h-full w-full object-contain"
                style={{
                  objectPosition: product.position ?? 'center',
                  transform: product.scale ? `scale(${product.scale})` : undefined,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function BaGoalStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  )
}

const trainingScenarios = [
  {
    question: 'Is Tapal good for everyday chai?',
    score: 91,
    feedback: [
      { type: 'success' as const, text: 'Clear daily-use positioning' },
      { type: 'success' as const, text: 'Mentioned family suitability' },
      { type: 'warning' as const, text: 'Add brew strength detail' },
    ],
  },
  {
    question: 'Why should I switch from your current tea?',
    score: 87,
    feedback: [
      { type: 'success' as const, text: 'Benefits explained well' },
      { type: 'success' as const, text: 'Good communication' },
      { type: 'warning' as const, text: 'Add more confidence' },
    ],
  },
  {
    question: 'Why should I switch from Lipton?',
    score: 84,
    feedback: [
      { type: 'success' as const, text: 'Respectful comparison' },
      { type: 'success' as const, text: 'Taste angle covered' },
      { type: 'warning' as const, text: 'Mention aroma and strength' },
    ],
  },
  {
    question: 'Which pack should I buy for a family of four?',
    score: 89,
    feedback: [
      { type: 'success' as const, text: 'Practical recommendation' },
      { type: 'success' as const, text: 'Value for money noted' },
      { type: 'warning' as const, text: 'Offer a trial size option' },
    ],
  },
  {
    question: 'Is Tapal Tea rich in antioxidants?',
    score: 93,
    feedback: [
      { type: 'success' as const, text: 'Accurate product claim' },
      { type: 'success' as const, text: 'Simple, reassuring tone' },
      { type: 'warning' as const, text: 'Link to overall wellness' },
    ],
  },
  {
    question: 'What makes Tapal Danedar different?',
    score: 82,
    feedback: [
      { type: 'success' as const, text: 'Highlighted rich leaf quality' },
      { type: 'warning' as const, text: 'Explain brew strength more clearly' },
      { type: 'warning' as const, text: 'Use a real-life chai example' },
    ],
  },
  {
    question: 'Is it good for doodh patti?',
    score: 88,
    feedback: [
      { type: 'success' as const, text: 'Confirmed strong-brew suitability' },
      { type: 'success' as const, text: 'Taste retention mentioned' },
      { type: 'warning' as const, text: 'Mention milk blend aroma' },
    ],
  },
  {
    question: 'Why is it more expensive than local brands?',
    score: 86,
    feedback: [
      { type: 'success' as const, text: 'Quality justification given' },
      { type: 'success' as const, text: 'Calm objection handling' },
      { type: 'warning' as const, text: 'Add cost-per-cup framing' },
    ],
  },
]

const TRAINING_TOTAL = trainingScenarios.length

export function BaTrainingPage() {
  const { account } = useBaSession()
  // A BA still onboarding goes through the video + verbal assessment; once certified,
  // the Training tab opens the fuller scenario library instead.
  if (account && account.status !== 'Certified') return <BaOnboarding account={account} />
  return <BaTrainingLibrary />
}

function BaTrainingLibrary() {
  const { modules } = useTrainingContent()
  const [mode, setMode] = useState<'video' | 'scenarios'>('video')
  const [moduleIndex, setModuleIndex] = useState(0)
  const [qIndex, setQIndex] = useState(0)
  const [videoAnswer, setVideoAnswer] = useState('')

  const [scenarioIndex, setScenarioIndex] = useState(1)
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const scenario = trainingScenarios[scenarioIndex]
  const module = modules[moduleIndex]
  const question = module?.questions[qIndex]

  function submitAnswer() {
    if (answer.trim().length < 8) return
    setSubmitted(true)
  }

  function nextScenario() {
    if (scenarioIndex >= TRAINING_TOTAL - 1) return
    setScenarioIndex((i) => i + 1)
    setAnswer('')
    setSubmitted(false)
  }

  function nextQuestion() {
    if (!module || videoAnswer.trim().length < 4) return
    if (qIndex >= module.questions.length - 1) {
      if (moduleIndex < modules.length - 1) {
        setModuleIndex((i) => i + 1)
        setQIndex(0)
        setVideoAnswer('')
      }
      return
    }
    setQIndex((i) => i + 1)
    setVideoAnswer('')
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col bg-[#f7f4ec] px-4 pb-6 pt-5">
      <div className="mx-auto mb-4 flex w-full max-w-md rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode('video')}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
            mode === 'video' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Training videos
        </button>
        <button
          type="button"
          onClick={() => setMode('scenarios')}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
            mode === 'scenarios' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Scenarios
        </button>
      </div>

      {mode === 'video' ? (
        modules.length === 0 || !module ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-500">
            No training videos published yet.
          </div>
        ) : (
          <div className="mx-auto w-full max-w-md flex-1 space-y-4">
            <div>
              <h1 className="text-center text-sm font-bold text-slate-800">{module.title}</h1>
              {module.description && (
                <p className="mt-1 text-center text-xs text-slate-500">{module.description}</p>
              )}
            </div>

            {module.videoUrl ? (
              <video
                src={module.videoUrl}
                controls
                className="w-full rounded-2xl bg-black shadow-sm"
              />
            ) : (
              <div className="rounded-2xl bg-slate-200/80 px-4 py-10 text-center text-sm text-slate-600">
                Video: {module.videoName}
              </div>
            )}

            {question && (
              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="text-xs font-semibold text-slate-500 uppercase">
                  Question {qIndex + 1}/{module.questions.length}
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-900">{question.prompt}</p>
                <textarea
                  value={videoAnswer}
                  onChange={(e) => setVideoAnswer(e.target.value)}
                  rows={3}
                  className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-[#faf6ee] px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:bg-white"
                  placeholder="Type your response..."
                />
                <button
                  type="button"
                  disabled={videoAnswer.trim().length < 4}
                  onClick={nextQuestion}
                  className="mt-4 w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {qIndex >= module.questions.length - 1 && moduleIndex >= modules.length - 1
                    ? 'Complete'
                    : 'Next question'}
                </button>
              </section>
            )}
          </div>
        )
      ) : (
        <>
          <h1 className="text-center text-sm font-bold text-slate-800">
            Scenario {scenarioIndex + 1} of {TRAINING_TOTAL}
          </h1>

          <div className="mt-5 flex-1 space-y-5">
            <section>
              <div className="text-xs font-bold text-slate-900">Shopper</div>
              <div className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm leading-relaxed text-slate-800">
                {scenario.question}
              </div>
            </section>

            <section>
              <div className="text-xs font-bold text-slate-900">Your Response</div>
              {!submitted ? (
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={4}
                  className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-[#faf6ee] px-4 py-3.5 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15"
                  placeholder="Type your answer..."
                />
              ) : (
                <div className="mt-2 rounded-xl border border-slate-200/80 bg-[#faf6ee] px-4 py-3.5 text-sm leading-relaxed text-slate-800">
                  {answer}
                </div>
              )}
            </section>

            {submitted && (
              <section className="animate-fade-up rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="text-sm font-bold text-brand-600">AI Coach Feedback</div>
                <div className="mt-3 flex items-end justify-between border-b border-slate-100 pb-3">
                  <span className="text-sm font-medium text-slate-600">Score</span>
                  <div className="leading-none">
                    <span className="text-3xl font-black text-navy-900">{scenario.score}</span>
                    <span className="text-sm font-medium text-slate-400">/100</span>
                  </div>
                </div>
                <ul className="mt-3 space-y-2.5">
                  {scenario.feedback.map((item) => (
                    <li key={item.text} className="flex items-start gap-2 text-sm font-medium text-brand-700">
                      {item.type === 'success' ? (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand-600" />
                      ) : (
                        <AlertCircle size={16} className="mt-0.5 shrink-0 text-gold-500" />
                      )}
                      {item.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="mt-6 shrink-0 pt-2">
            {!submitted ? (
              <button
                type="button"
                disabled={answer.trim().length < 8}
                onClick={submitAnswer}
                className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Submit Answer
              </button>
            ) : (
              <button
                type="button"
                onClick={nextScenario}
                disabled={scenarioIndex >= TRAINING_TOTAL - 1}
                className="w-full rounded-2xl bg-gradient-to-b from-brand-600 to-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/25 transition enabled:hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {scenarioIndex >= TRAINING_TOTAL - 1 ? 'Training Complete' : 'Next Scenario'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function BaPerformancePage() {
  const { account } = useBaSession()
  const baId = account?.id ?? 'ayesha'
  const monthTarget = targetForBa(baId, currentMonthKey(), useBaTargets())
  const me = buildIncentiveRoster().find((r) => r.baId === baId) ?? buildIncentiveRoster().find((r) => r.baId === 'ayesha')
  const rank = me?.rank ?? 2
  const basePay = me?.base ?? 0
  const incentive = me?.incentive ?? 0
  const totalPkr = basePay + incentive
  const daysWorked = 18

  return (
    <div className="space-y-4 bg-[#f7f4ec] p-4 pb-6">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-900">Rewards & Performance</h2>
        <p className="mt-0.5 text-sm text-slate-500">This week · Tapal Tea</p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 via-navy-800 to-brand-700 p-5 text-white shadow-lg shadow-navy-900/25">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold tracking-wide text-gold-400 uppercase">Your rank</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-5xl font-black text-gold-400">#{rank}</span>
              <span className="text-sm text-white/80">Lahore</span>
            </div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-500/20 ring-2 ring-gold-400/40">
            <Trophy className="text-gold-400" size={24} />
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
          <div className="text-[10px] font-medium text-white/70 uppercase">Earned</div>
          <div className="mt-0.5 text-lg font-bold text-gold-400">{formatPkr(totalPkr)}</div>
        </div>
      </div>

      {monthTarget && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">Target vs achievement</h3>
            <span className="text-[11px] font-semibold text-slate-500">{formatTargetMonth(monthTarget.month)}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold text-slate-900">{monthTarget.targetKg}</div>
              <div className="text-[10px] font-medium text-slate-500">Target Kg</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900">{monthTarget.salesKg}</div>
              <div className="text-[10px] font-medium text-slate-500">Sales Kg</div>
            </div>
            <div>
              <div className="text-lg font-bold text-brand-600">
                {achievementPct(monthTarget.targetKg, monthTarget.salesKg)}%
              </div>
              <div className="text-[10px] font-medium text-slate-500">Achievement</div>
            </div>
          </div>
        </div>
      )}


      <div className="grid grid-cols-2 gap-2">
        <BaStatPill label="Rating" value="4.8" />
        <BaStatPill label="Days worked" value={String(daysWorked)} />
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold text-slate-900">Target vs achievement</div>
          <span className="text-[11px] font-semibold text-slate-500">
            {formatTargetMonth(monthTarget?.month ?? currentMonthKey())}
          </span>
        </div>
        {monthTarget ? (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold text-slate-900">{monthTarget.targetKg}</div>
              <div className="text-[10px] font-medium text-slate-500">Target Kg</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900">{monthTarget.salesKg}</div>
              <div className="text-[10px] font-medium text-slate-500">Sales Kg</div>
            </div>
            <div>
              <div className="text-lg font-bold text-brand-600">
                {achievementPct(monthTarget.targetKg, monthTarget.salesKg)}%
              </div>
              <div className="text-[10px] font-medium text-slate-500">Achievement</div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No target has been set for this month yet.</p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="text-sm font-bold text-slate-900">PKR breakdown</div>
        <div className="mt-3 space-y-2.5">
          <BaPayRow label="Base pay" value={basePay} />
          <BaPayRow label="Incentive" value={incentive} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-sm font-bold text-slate-900">Total earned</span>
          <span className="text-lg font-black text-brand-600">{formatPkr(totalPkr)}</span>
        </div>
      </div>
    </div>
  )
}

function BaStatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-2 py-3 text-center shadow-sm ring-1 ring-black/5">
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium text-slate-500">{label}</div>
    </div>
  )
}

function BaPayRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-900">{formatPkr(value)}</span>
    </div>
  )
}
