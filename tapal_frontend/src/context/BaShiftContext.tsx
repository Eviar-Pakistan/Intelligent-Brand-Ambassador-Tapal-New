import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useBaSession } from '../lib/baAccounts'
import type { ParsedBaReport } from '../lib/baReport'
import { formatTime12 } from './ScheduleContext'

/** Demo unlock: Check Out becomes available this many ms after check-in */
const CHECKOUT_UNLOCK_AFTER_MS = 10_000
/** How often today's shift is fetched again, so HO edits reach the BA. */
const SHIFT_REFRESH_MS = 5 * 60_000

type TodayShift = {
  shift: string
  startTime: string | null
  endTime: string | null
  storeLabel: string
  city: string
  storeId: number
  storeName: string
  supervisorId: string | null
}

/** Where today's shift is, and who supervises that store (for check-in / check-out notices). */
export type ShiftStore = { id: number; name: string; supervisorId: string | null }

/** End of today's shift in minutes after midnight. Null when there is no shift today. */
let shiftEndMinutes: number | null = null

export type BaShiftState = {
  city: string
  /** Today's shift from the database, or null when none is scheduled. */
  hasShift: boolean
  storeLabel: string
  shiftStore: ShiftStore | null
  shiftLabel: string
  shiftEndLabel: string
  checkedIn: boolean
  checkInAt: Date | null
  checkedOut: boolean
  checkOutAt: Date | null
  shiftEnded: boolean
  canCheckOut: boolean
  reportSubmitted: boolean
  earlyCheckoutReason: string | null
  isEarlyCheckout: boolean
  checkIn: () => void
  endShift: () => void
  checkOut: () => void
  setEarlyCheckoutReason: (reason: string | null) => void
  markReportSubmitted: () => void
  /**
   * Check-out counts only once the report is submitted. Sends it to the server, which marks the BA Present,
   * then checks out here. Returns an error message when the server refuses (nothing changes then).
   */
  submitCheckoutReport: (report: ParsedBaReport) => Promise<string | null>
  resetShift: () => void
}

const BaShiftContext = createContext<BaShiftState | null>(null)

/** Checkout is on time when the clock reaches (or passes) shift end time. With no shift today nothing is early. */
export function isAtOrPastShiftEnd(now: Date) {
  if (shiftEndMinutes === null) return true
  return now.getHours() * 60 + now.getMinutes() >= shiftEndMinutes
}

function minutesOf(hhmm: string | null) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

export function BaShiftProvider({ children }: { children: ReactNode }) {
  const { account } = useBaSession()
  const token = account?.accessToken
  const [todayShift, setTodayShift] = useState<TodayShift | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [checkedIn, setCheckedIn] = useState(false)
  const [checkInAt, setCheckInAt] = useState<Date | null>(null)
  const [checkedOut, setCheckedOut] = useState(false)
  const [checkOutAt, setCheckOutAt] = useState<Date | null>(null)
  const [assistShiftEnded, setAssistShiftEnded] = useState(false)
  const [reportSubmitted, setReportSubmitted] = useState(false)
  const [earlyCheckoutReason, setEarlyCheckoutReason] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!token || token.startsWith('demo-')) {
      setTodayShift(null)
      return
    }
    let cancelled = false
    const load = () =>
      fetch(`/api/ba/today-shift/?token=${encodeURIComponent(token)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error()
          const data = (await response.json()) as { shift: TodayShift | null }
          if (!cancelled) setTodayShift(data.shift)
        })
        .catch(() => {
          // keep the last shift we had
        })
    void load()
    const id = window.setInterval(load, SHIFT_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [token])

  shiftEndMinutes = minutesOf(todayShift?.endTime ?? null)

  const atShiftEnd = isAtOrPastShiftEnd(now)
  const isEarlyCheckout = checkedIn && !checkedOut && !atShiftEnd
  const canCheckOut =
    checkedIn &&
    !checkedOut &&
    !reportSubmitted &&
    !!checkInAt &&
    now.getTime() - checkInAt.getTime() >= CHECKOUT_UNLOCK_AFTER_MS
  const shiftEnded = atShiftEnd || assistShiftEnded || canCheckOut

  const checkIn = useCallback(() => {
    const t = new Date()
    setCheckedIn(true)
    setCheckInAt(t)
    setCheckedOut(false)
    setCheckOutAt(null)
    setReportSubmitted(false)
    setEarlyCheckoutReason(null)
  }, [])

  const endShift = useCallback(() => {
    setAssistShiftEnded(true)
  }, [])

  const checkOut = useCallback(() => {
    setCheckedOut(true)
    setCheckOutAt(new Date())
  }, [])

  const markReportSubmitted = useCallback(() => {
    setReportSubmitted(true)
  }, [])

  const submitCheckoutReport = useCallback(
    async (report: ParsedBaReport) => {
      if (token && !token.startsWith('demo-')) {
        try {
          const response = await fetch('/api/ba/check-out/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, report, early_reason: earlyCheckoutReason ?? '' }),
          })
          if (!response.ok) {
            const data = (await response.json().catch(() => ({}))) as { detail?: string }
            return data.detail || 'Your check-out could not be saved. Please try again.'
          }
        } catch {
          return 'No connection. Your report was not sent — please try again.'
        }
      }
      setCheckedOut(true)
      setCheckOutAt(new Date())
      setReportSubmitted(true)
      return null
    },
    [token, earlyCheckoutReason],
  )

  const resetShift = useCallback(() => {
    setCheckedIn(false)
    setCheckInAt(null)
    setCheckedOut(false)
    setCheckOutAt(null)
    setAssistShiftEnded(false)
    setReportSubmitted(false)
    setEarlyCheckoutReason(null)
  }, [])

  const shiftEndLabel = todayShift?.endTime ? formatTime12(todayShift.endTime) : ''

  const value = useMemo(
    () => ({
      city: todayShift?.city || account?.city || '',
      hasShift: !!todayShift,
      storeLabel: todayShift?.storeLabel ?? '',
      shiftStore: todayShift
        ? { id: todayShift.storeId, name: todayShift.storeName, supervisorId: todayShift.supervisorId ?? null }
        : null,
      shiftLabel: todayShift?.shift ?? 'No shift scheduled today',
      shiftEndLabel,
      checkedIn,
      checkInAt,
      checkedOut,
      checkOutAt,
      shiftEnded,
      canCheckOut,
      reportSubmitted,
      earlyCheckoutReason,
      isEarlyCheckout,
      checkIn,
      endShift,
      checkOut,
      setEarlyCheckoutReason,
      markReportSubmitted,
      submitCheckoutReport,
      resetShift,
    }),
    [
      todayShift,
      account?.city,
      shiftEndLabel,
      checkedIn,
      checkInAt,
      checkedOut,
      checkOutAt,
      shiftEnded,
      canCheckOut,
      reportSubmitted,
      earlyCheckoutReason,
      isEarlyCheckout,
      checkIn,
      endShift,
      checkOut,
      markReportSubmitted,
      submitCheckoutReport,
      resetShift,
    ],
  )

  return <BaShiftContext.Provider value={value}>{children}</BaShiftContext.Provider>
}

export function useBaShift() {
  const ctx = useContext(BaShiftContext)
  if (!ctx) throw new Error('useBaShift must be used within BaShiftProvider')
  return ctx
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

export function formatDate(date: Date) {
  return date.toLocaleDateString('en-PK', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
