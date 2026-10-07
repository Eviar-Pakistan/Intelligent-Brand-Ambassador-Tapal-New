import {
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
import { BaShiftContext } from './baShiftContextObject'
import { getBaLocation, LOCATION_REQUIRED_MESSAGE } from '../lib/baLocation'

/** Demo unlock: Check Out becomes available this many ms after check-in */
const CHECKOUT_UNLOCK_AFTER_MS = 10_000
/** How often today's shift is fetched again, so HO edits reach the BA. */
const SHIFT_REFRESH_MS = 5 * 60_000
/** A shift request that takes longer than this counts as failed, so the BA can retry instead of waiting forever. */
const SHIFT_LOAD_TIMEOUT_MS = 10_000

/** Whether the server has told the app yet if the BA is checked in. */
export type ShiftStatus = 'loading' | 'ready' | 'error'

/** Sample accounts have no server record, so there is nothing to wait for. */
function needsServer(token: string | undefined) {
  return !!token && !token.startsWith('demo-')
}

type TodayShift = {
  shift: string
  startTime: string | null
  endTime: string | null
  /** Exact moment the shift ends, worked out by the server in Pakistan time. */
  endAt: string | null
  storeLabel: string
  city: string
  storeId: number
  storeName: string
  supervisorId: string | null
  checkedIn: boolean
  attendanceType?: 'store' | 'training'
  checkedOut: boolean
  checkedInAt: string | null
  checkedOutAt: string | null
  reportSubmitted?: boolean
  coveredByName?: string | null
  isCovering?: boolean
  reportOwner?: { id: number; name: string; baCode: string } | null
}

/** Where today's shift is, and who supervises that store (for check-in / check-out notices). */
export type ShiftStore = { id: number; name: string; supervisorId: string | null }

/** When today's shift ends (ms since epoch, from the server). Null when there is no shift today. */
let shiftEndAtMs: number | null = null
/** Server clock minus this phone's clock (ms), measured when the shift was loaded. Zero until then. */
let serverOffsetMs = 0

export type BaShiftState = {
  city: string
  /** Today's shift from the database, or null when none is scheduled. */
  hasShift: boolean
  storeLabel: string
  coveredByName: string | null
  reportingFor: string | null
  shiftStore: ShiftStore | null
  shiftLabel: string
  shiftEndLabel: string
  checkedIn: boolean
  attendanceType: 'store' | 'training'
  checkInAt: Date | null
  checkedOut: boolean
  checkOutAt: Date | null
  shiftEnded: boolean
  canCheckOut: boolean
  reportSubmitted: boolean
  earlyCheckoutReason: string | null
  isEarlyCheckout: boolean
  /**
   * Check-in counts only once the server has saved it. Returns an error message when it could not
   * be saved (nothing changes then), so the BA is never shown as checked in without a record.
   */
  checkIn: (selfie?: string, attendanceType?: 'store' | 'training') => Promise<string | null>
  endShift: () => void
  checkOut: () => void
  setEarlyCheckoutReason: (reason: string | null) => void
  markReportSubmitted: () => void
  /**
   * Check-out counts only once the report is submitted. Sends it to the server, which marks the BA Present,
   * then checks out here. Returns an error message when the server refuses (nothing changes then).
   */
  submitCheckoutReport: (report: ParsedBaReport, earlyReason?: string | null) => Promise<string | null>
  submitTrainingCheckout: () => Promise<string | null>
  resetShift: () => void
  /** Checked in and out already today: no second check-in until tomorrow. */
  doneForToday: boolean
  /** Ask the server for today's shift again (e.g. right after check-in). */
  reloadShift: () => void
  /**
   * 'loading' until the server first answers whether the BA is checked in, 'error' if it could not be reached.
   * The check-in button is shown only when 'ready', so a BA who already checked in never sees it by default.
   */
  shiftStatus: ShiftStatus
  /** Try again after a failed first load. */
  retryShiftLoad: () => void
}


/**
 * Checkout is on time when the server's clock reaches (or passes) the shift end. The phone's own clock and
 * time zone do not matter: its time is corrected by the offset measured against the server.
 * With no shift today nothing is early. The server makes the final decision at check-out.
 */
export function isAtOrPastShiftEnd(now: Date) {
  if (shiftEndAtMs === null) return true
  return now.getTime() + serverOffsetMs >= shiftEndAtMs
}

export function BaShiftProvider({ children }: { children: ReactNode }) {
  const { account } = useBaSession()
  const token = account?.accessToken
  const [todayShift, setTodayShift] = useState<TodayShift | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [checkedIn, setCheckedIn] = useState(false)
  const [attendanceType, setAttendanceType] = useState<'store' | 'training'>('store')
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

  const [reloadKey, setReloadKey] = useState(0)
  const reloadShift = useCallback(() => setReloadKey((k) => k + 1), [])
  const [shiftStatus, setShiftStatus] = useState<ShiftStatus>(() => (needsServer(token) ? 'loading' : 'ready'))
  const retryShiftLoad = useCallback(() => {
    setShiftStatus('loading')
    setReloadKey((k) => k + 1)
  }, [])

  // A different BA signing in starts again from "loading", so they never see the previous BA's state.
  useEffect(() => {
    setShiftStatus(needsServer(token) ? 'loading' : 'ready')
  }, [token])

  // Demo / sample accounts: session-only state (no localStorage). Refresh always shows Check In again.
  useEffect(() => {
    if (needsServer(token)) return
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i)
        if (key?.startsWith('ba-demo-shift-v1:')) localStorage.removeItem(key)
      }
    } catch {
      // ignore
    }
    setTodayShift(null)
    setCheckedIn(false)
    setAttendanceType('store')
    setCheckInAt(null)
    setCheckedOut(false)
    setCheckOutAt(null)
    setReportSubmitted(false)
    setAssistShiftEnded(false)
    setEarlyCheckoutReason(null)
    setShiftStatus('ready')
  }, [account?.id, token])

  useEffect(() => {
    if (!needsServer(token)) {
      setTodayShift(null)
      return
    }
    let cancelled = false
    const load = () => {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), SHIFT_LOAD_TIMEOUT_MS)
      return fetch(`/api/ba/today-shift/?token=${encodeURIComponent(token)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error()
          const data = (await response.json()) as { shift: TodayShift | null; serverNow?: string }
          if (cancelled) return
          const serverMs = data.serverNow ? Date.parse(data.serverNow) : NaN
          if (Number.isFinite(serverMs)) setClockOffsetMs(serverMs - Date.now())
          setTodayShift(data.shift)
          // The server is the record: once checked in (or out) today, the app shows that,
          // also after a reload or on another phone. One check-in and one check-out per day.
          const s = data.shift
          if (s?.checkedIn) {
            setCheckedIn(true)
            setAttendanceType(s.attendanceType === 'training' ? 'training' : 'store')
            if (s.checkedInAt) setCheckInAt(new Date(s.checkedInAt))
          }
          if (s?.checkedOut) {
            setCheckedOut(true)
            if (s.checkedOutAt) setCheckOutAt(new Date(s.checkedOutAt))
            setReportSubmitted(true)
          }
          setShiftStatus('ready')
        })
        .catch(() => {
          // Keep the last shift we had. Only the first load can fail visibly: once the status is known it stays.
          if (!cancelled) setShiftStatus((status) => (status === 'ready' ? status : 'error'))
        })
        .finally(() => window.clearTimeout(timer))
    }
    void load()
    const id = window.setInterval(load, SHIFT_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [token, reloadKey])

  const endAtMs = todayShift?.endAt ? Date.parse(todayShift.endAt) : NaN
  shiftEndAtMs = Number.isFinite(endAtMs) ? endAtMs : null
  serverOffsetMs = clockOffsetMs

  const atShiftEnd = isAtOrPastShiftEnd(now)
  const isEarlyCheckout = checkedIn && !checkedOut && !atShiftEnd
  const canCheckOut =
    checkedIn &&
    !checkedOut &&
    !reportSubmitted &&
    !!checkInAt &&
    now.getTime() + clockOffsetMs - checkInAt.getTime() >= CHECKOUT_UNLOCK_AFTER_MS
  const shiftEnded = atShiftEnd || assistShiftEnded || canCheckOut

  const doneForToday = checkedOut || !!todayShift?.checkedOut

  const checkIn = useCallback(
    async (selfie?: string, attendance: 'store' | 'training' = 'store') => {
      if (doneForToday) return 'You have already checked in and out today. Check-in opens again tomorrow.'
      if (!token) return 'Your account is not linked to the server, so you cannot check in. Please sign in again.'
      let t = new Date()
      if (needsServer(token)) {
        try {
          // The BA's position goes with the check-in. Without it there is no check-in.
          const location = await getBaLocation()
          if (!location) return LOCATION_REQUIRED_MESSAGE
          const response = await fetch('/api/ba/check-in/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, attendance_type: attendance, ...location, ...(selfie ? { selfie } : {}) }),
          })
          const data = (await response.json().catch(() => ({}))) as {
            detail?: string
            shift?: { checkedIn?: boolean; checkedInAt?: string | null; attendanceType?: 'store' | 'training' } | null
          }
          // Only the server's own confirmation counts: anything else leaves the BA not checked in.
          if (!response.ok || !data.shift?.checkedIn) {
            return data.detail || 'Your check-in could not be saved. Please try again.'
          }
          if (data.shift.checkedInAt) t = new Date(data.shift.checkedInAt)
          attendance = data.shift.attendanceType === 'training' ? 'training' : 'store'
        } catch {
          return 'No connection. You are not checked in — please try again.'
        }
      }
      setCheckedIn(true)
      setAttendanceType(attendance)
      setCheckInAt(t)
      setCheckedOut(false)
      setCheckOutAt(null)
      setReportSubmitted(false)
      setEarlyCheckoutReason(null)
      return null
    },
    [doneForToday, token],
  )

  const endShift = useCallback(() => {
    setAssistShiftEnded(true)
  }, [])

  const checkOut = useCallback(() => {
    const time = new Date()
    setCheckedOut(true)
    setCheckOutAt(time)
  }, [])

  const markReportSubmitted = useCallback(() => {
    setReportSubmitted(true)
  }, [])

  const submitCheckoutReport = useCallback(
    async (report: ParsedBaReport, earlyReason?: string | null) => {
      if (needsServer(token)) {
        try {
          // The BA's position goes with the check-out. Without it there is no check-out.
          const location = await getBaLocation()
          if (!location) return LOCATION_REQUIRED_MESSAGE
          const response = await fetch('/api/ba/check-out/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, report, early_reason: earlyReason ?? earlyCheckoutReason ?? '', ...location }),
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
      const time = new Date()
      setCheckOutAt(time)
      setReportSubmitted(true)
      return null
    },
    [token, earlyCheckoutReason],
  )

  const submitTrainingCheckout = useCallback(async () => {
    if (needsServer(token)) {
      try {
        const location = await getBaLocation()
        if (!location) return LOCATION_REQUIRED_MESSAGE
        const response = await fetch('/api/ba/check-out/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, ...location }),
        })
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { detail?: string }
          return data.detail || 'Your training check-out could not be saved. Please try again.'
        }
      } catch {
        return 'No connection. Your training check-out was not saved — please try again.'
      }
    }
    const time = new Date()
    setCheckedOut(true)
    setCheckOutAt(time)
    setReportSubmitted(true)
    return null
  }, [token])

  const resetShift = useCallback(() => {
    setCheckedIn(false)
    setAttendanceType('store')
    setCheckInAt(null)
    setCheckedOut(false)
    setCheckOutAt(null)
    setAssistShiftEnded(false)
    setReportSubmitted(false)
    setEarlyCheckoutReason(null)
  }, [])

  const shiftEndLabel = todayShift?.endTime ? formatTime12(todayShift.endTime) : ''
  const demoSession = !needsServer(token)
  const demoStoreLabel = 'Demo Store — Tapal Showcase'
  const demoCity = account?.city || 'Lahore'

  const value = useMemo(
    () => ({
      city: todayShift?.city || (demoSession ? demoCity : account?.city || ''),
      hasShift: !!todayShift || demoSession,
      storeLabel: todayShift?.storeLabel ?? (demoSession ? demoStoreLabel : ''),
      coveredByName: todayShift?.coveredByName ?? null,
      reportingFor: todayShift?.isCovering ? todayShift.reportOwner?.name ?? null : null,
      shiftStore: todayShift
        ? { id: todayShift.storeId, name: todayShift.storeName, supervisorId: todayShift.supervisorId ?? null }
        : demoSession
          ? { id: 9001, name: demoStoreLabel, supervisorId: null }
          : null,
      shiftLabel: todayShift?.shift ?? (demoSession ? 'Demo shift (session only)' : 'No shift scheduled today'),
      shiftEndLabel,
      checkedIn,
      attendanceType,
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
      submitTrainingCheckout,
      resetShift,
      doneForToday,
      reloadShift,
      shiftStatus,
      retryShiftLoad,
    }),
    [
      todayShift,
      account?.city,
      demoSession,
      demoCity,
      demoStoreLabel,
      shiftEndLabel,
      checkedIn,
      attendanceType,
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
      submitTrainingCheckout,
      resetShift,
      doneForToday,
      reloadShift,
      shiftStatus,
      retryShiftLoad,
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
