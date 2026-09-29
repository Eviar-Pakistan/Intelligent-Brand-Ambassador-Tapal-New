import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { djangoFetch, djangoToken } from '../lib/djangoApi'

/** A BA at a store at the same hours for a whole month (from /api/shifts/). No dates. */
export type MonthlyShift = {
  id: string
  /** YYYY-MM */
  month: string
  monthLabel: string
  storeId: number
  storeName: string
  storeCode: string
  city: string
  /** 12-hour label, e.g. 10:00 AM – 6:00 PM */
  shift: string
  /** 24-hour HH:MM */
  startTime: string
  endTime: string
  peakRecommended: boolean
  baId: string | null
  baName: string | null
  baCode: string | null
  status: 'Scheduled' | 'Open' | 'Conflict'
}

/** Fields the board can send when it creates or edits a monthly shift. */
export type ShiftInput = {
  storeId?: number
  month?: string
  startTime?: string
  endTime?: string
  /** Server ambassador id, or null to leave the shift open. */
  ambassadorId?: number | null
}

type ScheduleContextValue = {
  schedule: MonthlyShift[]
  /** YYYY-MM */
  month: string
  monthLabel: string
  loading: boolean
  error: string | null
  shiftMonth: (months: number) => void
  reload: () => Promise<void>
  saveShift: (input: ShiftInput, id?: string) => Promise<string | null>
  clearBaFromSlot: (id: string) => Promise<string | null>
  deleteShift: (id: string) => Promise<string | null>
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null)

export function formatTime12(hhmm: string) {
  const [hRaw, mRaw] = hhmm.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = ((h + 11) % 12) + 1
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function shiftLabelFromTimes(start: string, end: string) {
  return `${formatTime12(start)} – ${formatTime12(end)}`
}

/** Frontend BA ids for server ambassadors look like "api-12". */
export function serverAmbassadorId(accountId: string) {
  const match = /^api-(\d+)$/.exec(accountId)
  return match ? Number(match[1]) : null
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

async function readError(response: Response) {
  try {
    const data = (await response.json()) as Record<string, unknown>
    const first = Object.values(data)[0]
    if (typeof first === 'string') return first
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
  } catch {
    // fall through
  }
  return 'The shift could not be saved.'
}

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [schedule, setSchedule] = useState<MonthlyShift[]>([])
  const [monthLabel, setMonthLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!djangoToken()) {
      setSchedule([])
      setError('Sign in to Head Office to see shifts.')
      return
    }
    setLoading(true)
    try {
      const response = await djangoFetch(`/api/shifts/?month=${month}`)
      if (!response.ok) throw new Error()
      const data = (await response.json()) as { results: MonthlyShift[]; month_label: string }
      setSchedule(data.results)
      setMonthLabel(data.month_label)
      setError(null)
    } catch {
      setError('Shifts could not be loaded. Check that the server is running.')
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void reload()
  }, [reload])

  const shiftMonth = useCallback((months: number) => {
    setMonth((current) => {
      const [year, mon] = current.split('-').map(Number)
      return monthKey(new Date(year, mon - 1 + months, 1))
    })
  }, [])

  const saveShift = useCallback(
    async (input: ShiftInput, id?: string) => {
      const body: Record<string, unknown> = {}
      if (input.storeId !== undefined) body.store_id = input.storeId
      if (input.month !== undefined) body.month = input.month
      if (input.startTime !== undefined) body.startTime = input.startTime
      if (input.endTime !== undefined) body.endTime = input.endTime
      if (input.ambassadorId !== undefined) body.ambassador_id = input.ambassadorId
      try {
        const response = await djangoFetch(id ? `/api/shifts/${id}/` : '/api/shifts/', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        })
        if (!response.ok) return await readError(response)
      } catch {
        return 'The server is not available. Start it, then try again.'
      }
      await reload()
      return null
    },
    [reload],
  )

  const clearBaFromSlot = useCallback((id: string) => saveShift({ ambassadorId: null }, id), [saveShift])

  const deleteShift = useCallback(
    async (id: string) => {
      try {
        const response = await djangoFetch(`/api/shifts/${id}/`, { method: 'DELETE' })
        if (!response.ok) return 'The shift could not be deleted.'
      } catch {
        return 'The server is not available. Start it, then try again.'
      }
      await reload()
      return null
    },
    [reload],
  )

  const value = useMemo(
    () => ({ schedule, month, monthLabel, loading, error, shiftMonth, reload, saveShift, clearBaFromSlot, deleteShift }),
    [schedule, month, monthLabel, loading, error, shiftMonth, reload, saveShift, clearBaFromSlot, deleteShift],
  )

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>
}

export function useSchedule() {
  const ctx = useContext(ScheduleContext)
  if (!ctx) throw new Error('useSchedule must be used within ScheduleProvider')
  return ctx
}
