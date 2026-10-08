import type { ParsedBaReport } from '../../lib/baReport'
import { portalSend } from '../../lib/serverApi'
import { useKpiConfig } from '../../lib/kpiConfig'
import { baStatusLabel, useBaMe } from '../../lib/baMe'
import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  CloudSun,
  Download,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Trophy,
  Upload,
  UserRound,
} from 'lucide-react'
import { calculateIncentive, formatPkr } from '../../lib/incentives'
import {
  achievementPct,
  currentMonthKey,
  formatTargetMonth,
} from '../../lib/baTargets'
import { useBrand } from '../../context/BrandContext'
import { formatDate, formatTime, useBaShift } from '../../context/BaShiftContext'
import { useTrainingContent } from '../../context/TrainingContentContext'
import {
  downloadBaReportTemplate,
  hasAnytimeStockSubmitted,
  labeledSales,
  localDayKey,
  packKgForSales,
  parseBaReportFile,
  recordDailyReport,
  saveBaReport,
  useDailyReports,
  type StoredDailyReport,
} from '../../lib/baReport'
import { FaceCheckInModal } from '../../components/FaceCheckInModal'
import { Modal } from '../../components/ui'
import { useBaSession } from '../../lib/baAccounts'
import { recordEarlyCheckout } from '../../lib/earlyCheckouts'
import { useUserInterceptions } from '../../lib/userInterceptions'
import { BaOnboarding } from './BaOnboarding'
import { loadSkuCatalogue, type SkuRow } from '../../lib/skuCatalogue'

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
  const me = useBaMe()
  const { brand } = useBrand()
  const { account } = useBaSession()
  const baName = account?.name ?? 'Brand Ambassador'
  const navigate = useNavigate()
  const {
    city,
    storeLabel,
    coveredByName,
    reportingFor,
    shiftLabel,
    shiftEndLabel,
    checkedIn,
    attendanceType,
    checkInAt,
    canCheckOut,
    reportSubmitted,
    isEarlyCheckout,
    earlyCheckoutReason,
    checkIn,
    setEarlyCheckoutReason,
    submitCheckoutReport,
    submitTrainingCheckout,
    doneForToday,
    reloadShift,
    shiftStatus,
    retryShiftLoad,
  } = useBaShift()

  const [now, setNow] = useState(() => new Date())
  const [tempC, setTempC] = useState<string | null>(null)
  const [weatherText, setWeatherText] = useState('Loading…')
  const [faceCheckOpen, setFaceCheckOpen] = useState(false)
  const [checkInMode, setCheckInMode] = useState<'store' | 'training'>('store')
  const [checkInBusy, setCheckInBusy] = useState(false)
  const [checkInError, setCheckInError] = useState<string | null>(null)
  const [trainingCheckoutBusy, setTrainingCheckoutBusy] = useState(false)
  const [trainingCheckoutError, setTrainingCheckoutError] = useState<string | null>(null)
  const [checkoutWarningOpen, setCheckoutWarningOpen] = useState(false)
  const [earlyReasonOpen, setEarlyReasonOpen] = useState(false)
  const [earlyReason, setEarlyReason] = useState('')
  const [excelFileName, setExcelFileName] = useState<string | null>(null)
  const [excelErrors, setExcelErrors] = useState<string[]>([])
  const [excelBusy, setExcelBusy] = useState(false)
  const excelInputRef = useRef<HTMLInputElement>(null)
  // A report file waiting for the early check-out reason before it checks the BA out
  const [pendingExcel, setPendingExcel] = useState<{ file: File; data: ParsedBaReport } | null>(null)
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
    // Uploading checks out. Before shift end, ask for the early check-out reason first.
    if (!reportSubmitted && isEarlyCheckout && !earlyCheckoutReason) {
      setPendingExcel({ file, data: result.data })
      setEarlyReason('')
      setEarlyReasonOpen(true)
      return
    }
    await finishExcelCheckout(file, result.data, earlyCheckoutReason)
  }

  async function finishExcelCheckout(file: File, data: ParsedBaReport, reason: string | null) {
    const result = { data }
    // Checking out with the file counts only once the server has the report (that marks attendance).
    if (!reportSubmitted) {
      setExcelBusy(true)
      const problem = await submitCheckoutReport(result.data, reason)
      setExcelBusy(false)
      if (problem) {
        setExcelErrors([problem])
        return
      }
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
      if (isEarlyCheckout) {
        recordEarlyCheckout({
          baId,
          baName,
          reason: reason ?? earlyCheckoutReason ?? 'Checked out before shift end',
        })
      }
    }
  }

  function handleCheckOutClick() {
    if (attendanceType === 'training') {
      void finishTrainingCheckout()
      return
    }
    if (isEarlyCheckout) {
      setEarlyReason('')
      setEarlyReasonOpen(true)
      return
    }
    setCheckoutWarningOpen(true)
  }

  async function finishTrainingCheckout() {
    setTrainingCheckoutBusy(true)
    setTrainingCheckoutError(null)
    const problem = await submitTrainingCheckout()
    setTrainingCheckoutBusy(false)
    if (problem) {
      setTrainingCheckoutError(problem)
      return
    }
    reloadShift()
  }

  function submitEarlyReason() {
    const reason = earlyReason.trim()
    if (reason.length < 8) return
    setEarlyCheckoutReason(reason)
    setEarlyReasonOpen(false)
    if (pendingExcel) {
      // The uploaded report file was waiting for this reason: check out with it now.
      const { file, data } = pendingExcel
      setPendingExcel(null)
      void finishExcelCheckout(file, data, reason)
      return
    }
    setCheckoutWarningOpen(true)
  }

  function cancelEarlyReason() {
    setEarlyReasonOpen(false)
    if (pendingExcel) {
      setPendingExcel(null)
      setExcelErrors(['Upload cancelled — you have not checked out.'])
    }
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
            <p className="mt-1 text-base font-semibold text-brand-600">
              {baStatusLabel(me?.status ?? (account?.status === 'Certified' ? 'Certified' : account?.status))}
            </p>
          </div>
        </div>
      </div>



      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <h3 className="text-sm font-bold text-slate-900">Today&apos;s Shift</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-100 to-brand-200 text-sm font-bold text-brand-700 ring-2 ring-white">
            {initialsOf(baName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900">
              {shiftStatus === 'ready' ? storeLabel || city || 'No store assigned' : city || 'Today'}
            </div>
            <div className="text-sm text-slate-500">
              {shiftStatus === 'ready' ? shiftLabel : shiftStatus === 'loading' ? 'Loading…' : '—'}
            </div>
          </div>
          {/* Check In shows only once the server has said whether the BA is already checked in. */}
          {shiftStatus === 'loading' ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
              <Loader2 size={14} className="animate-spin" />
              Checking your status…
            </span>
          ) : shiftStatus === 'error' ? (
            <button
              type="button"
              onClick={retryShiftLoad}
              className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              Retry
            </button>
          ) : !checkedIn && !doneForToday && !coveredByName ? (
            <button
              type="button"
              onClick={() => { setCheckInMode('store'); setFaceCheckOpen(true) }}
              className="shrink-0 rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
            >
              Check In
            </button>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
              <CheckCircle2 size={14} />
              {coveredByName
                ? 'Marked Absent'
                : doneForToday
                  ? 'Done for today'
                  : attendanceType === 'training'
                    ? 'Checked in for training'
                    : 'Checked in at store'}
            </span>
          )}
        </div>
        {coveredByName && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This shift is marked Absent and covered by {coveredByName}.
          </p>
        )}
        {reportingFor && (
          <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800">
            You are covering {reportingFor}. Your attendance is recorded for you; reports and target credit go to {reportingFor}.
          </p>
        )}

        {shiftStatus === 'error' && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800">
            Could not load your status. Check your internet, then tap Retry.
          </p>
        )}

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
              disabled={!canCheckOut || trainingCheckoutBusy}
              onClick={handleCheckOutClick}
              className="mt-3 w-full rounded-2xl bg-navy-900 py-3 text-sm font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
            >
              {trainingCheckoutBusy ? 'Checking out…' : attendanceType === 'training' ? 'Check Out of Training' : 'Check Out'}
            </button>
            {!canCheckOut && (
              <p className="mt-2 text-center text-xs text-slate-500">
                Check Out enables 10 seconds after check-in
              </p>
            )}
            {canCheckOut && isEarlyCheckout && (
              attendanceType === 'store' && <p className="mt-2 text-center text-xs text-amber-700">
                Shift ends at {shiftEndLabel}. Early checkout requires a reason.
              </p>
            )}
            {trainingCheckoutError && (
              <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{trainingCheckoutError}</p>
            )}
          </>
        )}

        {reportSubmitted && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-700">
            <CheckCircle2 size={16} />
            {attendanceType === 'training' ? 'Training attendance complete' : 'Today’s report submitted'}
          </div>
        )}
      </div>

      {/* Today's footfall card (BaFootfallCard) is hidden for now. */}

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
            ? 'Today’s stock report is submitted. Checkout will ask for your closing stock again.'
            : 'Submit stock at any time. Checkout also asks for stock, daily sales and competitor data.'}
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

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-brand-600" />
          <h3 className="text-sm font-bold text-slate-900">Training attendance</h3>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Use this check-in when you are attending training instead of working at your store.
        </p>
        <button
          type="button"
          disabled={shiftStatus !== 'ready' || checkedIn || doneForToday}
          onClick={() => { setCheckInMode('training'); setFaceCheckOpen(true) }}
          className="mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-brand-600 bg-white py-3 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          {checkedIn
            ? attendanceType === 'training' ? 'Checked In for Training' : 'Unavailable · already checked in'
            : doneForToday
              ? 'Shift completed today'
              : shiftStatus === 'loading'
                ? 'Loading shift status…'
                : shiftStatus === 'error'
                  ? 'Retry shift status to check in'
                  : 'Training Check In'}
        </button>
      </div>

      {checkedIn && attendanceType === 'store' && (
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
        onClose={() => {
          setFaceCheckOpen(false)
          setCheckInError(null)
        }}
        busy={checkInBusy}
        error={checkInError}
        title={checkInMode === 'training' ? 'Training face check-in' : 'Face check-in'}
        confirmLabel={checkInMode === 'training' ? 'Check In for Training' : 'Check In at Store'}
        onConfirmed={async (selfie) => {
          // Checked in only once the server has saved it; otherwise the BA sees why and can retry.
          setCheckInBusy(true)
          setCheckInError(null)
          const problem = await checkIn(selfie, checkInMode)
          setCheckInBusy(false)
          if (problem) {
            setCheckInError(problem)
            return
          }
          // Re-read today's shift so the app matches what the server recorded.
          reloadShift()
          setFaceCheckOpen(false)
        }}
      />

      <Modal
        open={earlyReasonOpen}
        onClose={cancelEarlyReason}
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
              onClick={cancelEarlyReason}
              className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:px-5"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={checkoutWarningOpen}
        onClose={() => {
          setEarlyCheckoutReason(null)
          setCheckoutWarningOpen(false)
        }}
        title="Complete your reports"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={22} />
            <p className="text-sm leading-relaxed text-slate-800">
              Checkout includes the <span className="font-semibold">Stock Report</span>,{' '}
              <span className="font-semibold">Daily Sales</span>, and{' '}
              <span className="font-semibold">Competitor data</span>. Competitor prices are optional.
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
                // Check-out happens when the last report is submitted, not here.
                setCheckoutWarningOpen(false)
                navigate('/ba/stock-report')
              }}
              className="w-full rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 sm:w-auto sm:px-5"
            >
              Continue to reports
            </button>
            <button
              type="button"
              onClick={() => {
                setEarlyCheckoutReason(null)
                setCheckoutWarningOpen(false)
              }}
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
          <BaGoalStat label="Engagement" value={me ? `${me.today.interceptions}/${me.today.dailyGoal}` : '—'} />
          <BaGoalStat
            label="Conversions"
            value={me && me.today.interceptions ? `${Math.round((me.today.switched / me.today.interceptions) * 100)}%` : '—'}
          />
          <BaGoalStat
            label="Month target"
            value={
              me?.monthTarget ? `${achievementPct(me.monthTarget.targetKg, me.monthTarget.salesKg)}%` : '—'
            }
          />
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

/** Retraining answers go to the server so Head Office sees them on the BA's profile. */
function savePractice(kind: 'video' | 'scenario', title: string, question: string, answer: string) {
  void portalSend('/api/ba/training/practice/', 'POST', { kind, title, question, answer: answer.trim() }, 'ba').catch(
    () => undefined,
  )
}

export function BaTrainingPage() {
  const { account } = useBaSession()
  // A BA still onboarding goes through the video + verbal assessment; once certified,
  // the Training tab opens the fuller scenario library instead.
  if (account?.result || (account && account.status !== 'Certified')) return <BaOnboarding account={account} />
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
    savePractice('scenario', `Scenario ${scenarioIndex + 1}`, scenario.question, answer)
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
    if (question) savePractice('video', module.title, question.prompt, videoAnswer)
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

type RewardPeriod = 'today' | 'yesterday' | 'last7' | 'month'

function periodBounds(period: RewardPeriod, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start)
  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1)
    end.setDate(end.getDate() - 1)
  }
  if (period === 'last7') start.setDate(start.getDate() - 6)
  if (period === 'month') start.setDate(1)
  return { start, end }
}

function salesForPeriod(
  reports: StoredDailyReport[],
  baId: string,
  period: RewardPeriod,
  catalogue: SkuRow[],
  target: { sku: string; grammage?: number }[],
) {
  const { start, end } = periodBounds(period)
  const startKey = localDayKey(start)
  const endKey = localDayKey(end)
  const byDay = new Map<string, StoredDailyReport>()
  for (const report of [...reports].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (report.baId !== baId) continue
    const key = localDayKey(report.submittedAt)
    if (key < startKey || key > endKey) continue
    const skuLines = labeledSales(report.sales).filter((line) => line.section.toLowerCase().includes('sales'))
    const hasSalesSubmission =
      report.source === 'checkout' ||
      (report.source === 'excel' && skuLines.some((line) => Number(line.value) > 0))
    if (hasSalesSubmission) byDay.set(key, report)
  }
  const bySku = new Map<string, { sku: string; kg: number; units: number }>()
  for (const report of byDay.values()) {
    for (const line of labeledSales(report.sales).filter((row) => row.section.toLowerCase().includes('sales'))) {
      const amount = Number(line.value)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const grams = packKgForSales(line.item, catalogue, target)
      const row = bySku.get(line.item.toLowerCase()) ?? { sku: line.item, kg: 0, units: 0 }
      if (line.section.toLowerCase().includes('(units)')) {
        row.units += amount
        row.kg += grams * amount
      } else {
        row.kg += amount
        if (grams > 0) row.units += amount / grams
      }
      bySku.set(line.item.toLowerCase(), row)
    }
  }
  const items = [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku))
  const totals = items.reduce((total, item) => ({ kg: total.kg + item.kg, units: total.units + item.units }), {
    kg: 0,
    units: 0,
  })
  return { ...totals, items }
}

export function BaPerformancePage() {
  const me = useBaMe()
  const { account } = useBaSession()
  const reports = useDailyReports()
  const [period, setPeriod] = useState<RewardPeriod>('month')
  const [catalogue, setCatalogue] = useState<SkuRow[]>([])
  useEffect(() => { void loadSkuCatalogue().then(setCatalogue) }, [])
  const kpi = useKpiConfig()
  const target = me?.monthTarget ?? null
  const sales = useMemo(
    () => salesForPeriod(reports, account?.id ?? '', period, catalogue, target?.lines ?? []),
    [reports, account?.id, period, catalogue, target?.lines],
  )
  const targetKg = target?.targetKg ?? 0
  const detailRows = useMemo(() => {
    const rows = new Map<string, { sku: string; targetKg: number; soldKg: number; soldUnits: number }>()
    for (const line of target?.lines ?? []) rows.set(line.sku.toLowerCase(), {
      sku: line.sku, targetKg: line.kg, soldKg: 0, soldUnits: 0,
    })
    for (const line of sales.items) {
      const existing = rows.get(line.sku.toLowerCase()) ?? { sku: line.sku, targetKg: 0, soldKg: 0, soldUnits: 0 }
      existing.soldKg = line.kg
      existing.soldUnits = line.units
      rows.set(line.sku.toLowerCase(), existing)
    }
    return [...rows.values()].sort((a, b) => a.sku.localeCompare(b.sku))
  }, [target?.lines, sales.items])
  // Pay: base + conversion and session incentives, from the KPI settings Head Office set.
  const pay = me
    ? calculateIncentive(
        { baId: '', name: me.name, city: me.city, rank: me.rank ?? 0, conversion: me.conversion, sessions: me.weekSessions },
        kpi,
      )
    : null

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
              <span className="text-5xl font-black text-gold-400">{me?.rank ? `#${me.rank}` : '—'}</span>
              <span className="text-sm text-white/80">
                {me?.rank ? `of ${me.rankedOutOf}` : 'Not ranked yet'}
                {me?.city ? ` · ${me.city}` : ''}
              </span>
            </div>
            {me && <div className="mt-1 text-xs text-white/70">{me.points.toLocaleString()} points</div>}
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-500/20 ring-2 ring-gold-400/40">
            <Trophy className="text-gold-400" size={24} />
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
          <div className="text-[10px] font-medium text-white/70 uppercase">Earned this week</div>
          <div className="mt-0.5 text-lg font-bold text-gold-400">{pay ? formatPkr(pay.totalPkr) : '—'}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <BaStatPill label="Rating" value={me?.rating != null ? `${me.rating} ★` : '—'} />
        <BaStatPill label="Days worked" value={me ? String(me.daysWorked) : '—'} />
        <BaStatPill label="Conversion" value={me ? `${me.conversion}%` : '—'} />
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">Sales & target achievement</div>
            <div className="mt-0.5 text-[11px] text-slate-500">Sales for selected period · target for {formatTargetMonth(target?.month ?? currentMonthKey())}</div>
          </div>
          <select aria-label="Sales period" value={period} onChange={(e) => setPeriod(e.target.value as RewardPeriod)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-500 sm:w-auto">
            <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last7">Last 7 days</option><option value="month">Current month</option>
          </select>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <RewardMetric label="Target (kg)" value={fmtNum(Math.round(targetKg))} />
          <RewardMetric label="Sales (kg)" value={fmtNum(sales.kg)} />
          <RewardMetric label="Sales (units)" value={fmtNum(Math.round(sales.units))} />
          <RewardMetric label="Achievement" value={`${achievementPct(targetKg, sales.kg)}%`} highlight />
        </div>
        {!target && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">No target is assigned for this month. Target and achievement are shown as 0%; reported sales are still included.</p>}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Sales by SKU · selected period</div>
          {detailRows.length === 0 ? <p className="py-2 text-xs text-slate-500">No SKU sales reported for this period.</p> : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {detailRows.map((line) => (
                <div key={line.sku} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-slate-50 pb-2 text-xs last:border-0">
                  <span className="min-w-0 break-words font-medium text-slate-700">{line.sku}</span>
                  <span className="text-right tabular-nums"><span className="block font-semibold text-slate-900">{fmtNum(line.soldKg)} kg</span><span className="text-[10px] text-slate-500">target {fmtNum(Math.round(line.targetKg))} kg</span></span>
                  <span className="text-right tabular-nums"><span className="block font-semibold text-slate-900">{fmtNum(Math.round(line.soldUnits))} units</span><span className="text-[10px] text-brand-600">{achievementPct(line.targetKg, line.soldKg)}%</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="text-sm font-bold text-slate-900">PKR breakdown</div>
        <div className="mt-3 space-y-2.5">
          <BaPayRow label="Base pay" value={pay?.base ?? 0} />
          <BaPayRow label={`Conversion (${me?.conversion ?? 0}%)`} value={pay?.conversionPay ?? 0} />
          <BaPayRow label={`Sessions (${me?.weekSessions ?? 0} this week)`} value={pay?.sessionPay ?? 0} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-sm font-bold text-slate-900">Total earned</span>
          <span className="text-lg font-black text-brand-600">{formatPkr(pay?.totalPkr ?? 0)}</span>
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

function RewardMetric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2 py-3">
      <div className={`break-words text-lg font-bold ${highlight ? 'text-brand-600' : 'text-slate-900'}`}>{value}</div>
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

/** Up to 3 decimals, no trailing zeros: 0.6, 9.6, 22.22. */
function fmtNum(value: number) {
  return (Math.round(value * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })
}
