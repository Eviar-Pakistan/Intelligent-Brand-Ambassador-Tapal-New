import { activeBasByStore, baCheckInOutByStore } from './mock'

/**
 * BA attendance for the Dashboard, by date range.
 * Today comes from the live store table / check-in log in mock.ts; earlier days are
 * deterministic mock history (no per-day attendance data exists yet).
 */

export type DateRange = { start: Date; end: Date }

const SHIFT_START_MIN = 8 * 60
const SHIFT_END_MIN = 20 * 60
const DAY_MS = 24 * 60 * 60 * 1000

const dayKey = (d: Date) => d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate()
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

function hash(a: number, b: number) {
  return Math.imul(a ^ Math.imul(b + 1, 0x9e3779b1), 2654435761) >>> 0
}

export function daysInRange({ start, end }: DateRange) {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1
}

function eachDay(range: DateRange) {
  const days: Date[] = []
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) days.push(d)
  return days
}

export const baCities = [...new Set(activeBasByStore.map((r) => r.city))]

// ─── Active / Break / Offline ────────────────────────────────────────────────

type StatusCounts = { active: number; break: number; offline: number }

export type CityStatus = StatusCounts & { city: string; stores: number; total: number }

function statusForStoreDay(row: (typeof activeBasByStore)[number], day: Date, today: Date): StatusCounts {
  if (sameDay(day, today)) return { active: row.active, break: row.break, offline: row.offline }
  const h = hash(dayKey(day), row.storeId)
  const onBreak = Math.min(row.total, h % 3 === 0 ? 1 : 0)
  const offline = Math.min(row.total - onBreak, (h >>> 8) % 3 === 0 ? 1 : 0)
  return { active: row.total - onBreak - offline, break: onBreak, offline }
}

export type AttendanceFilters = {
  /** Empty or omitted means every city. */
  cities?: string[]
  /** Empty or omitted means every store. */
  stores?: string[]
  /** Empty or omitted means every month. */
  months?: string[]
}

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function matchesSelection(selected: string[] | undefined, value: string) {
  return !selected?.length || selected.includes(value)
}

/**
 * City-wise BA status over a range. One day is an exact headcount; longer ranges are
 * the per-day average, rounded. The overall figures are the sum of the city rows.
 */
export function baStatusByCity(range: DateRange, filters: AttendanceFilters = {}, today = new Date()) {
  const days = eachDay(range)
  const sums = new Map<string, StatusCounts & { stores: number }>()
  const countedDays = days.filter((d) => matchesSelection(filters.months, MONTHS_LONG[d.getMonth()]))
  const dayCount = countedDays.length || 1
  for (const row of activeBasByStore) {
    if (!matchesSelection(filters.cities, row.city)) continue
    if (!matchesSelection(filters.stores, row.store)) continue
    const c = sums.get(row.city) ?? { active: 0, break: 0, offline: 0, stores: 0 }
    c.stores += 1
    for (const d of countedDays) {
      const s = statusForStoreDay(row, d, today)
      c.active += s.active
      c.break += s.break
      c.offline += s.offline
    }
    sums.set(row.city, c)
  }

  const cities = [...sums.entries()].map<CityStatus>(([city, c]) => {
    const active = Math.round(c.active / dayCount)
    const onBreak = Math.round(c.break / dayCount)
    const offline = Math.round(c.offline / dayCount)
    return { city, stores: c.stores, active, break: onBreak, offline, total: active + onBreak + offline }
  })

  return {
    days: countedDays.length,
    cities,
    active: cities.reduce((s, c) => s + c.active, 0),
    break: cities.reduce((s, c) => s + c.break, 0),
    offline: cities.reduce((s, c) => s + c.offline, 0),
  }
}

// ─── Check-in / check-out and working hours ──────────────────────────────────

export type AttendanceRecord = {
  ba: string
  store: string
  city: string
  date: Date
  checkInMin: number
  /** null while still on shift */
  checkOutMin: number | null
  hours: number
}

function clockToMinutes(text: string) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text.trim())
  if (!m) return null
  return (Number(m[1]) % 12) * 60 + Number(m[2]) + (m[3].toUpperCase() === 'PM' ? 12 * 60 : 0)
}

export function formatClock(minutes: number) {
  const h24 = Math.floor(minutes / 60) % 24
  const mm = String(Math.round(minutes % 60)).padStart(2, '0')
  return `${String(h24 % 12 || 12).padStart(2, '0')}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`
}

function recordsForDay(day: Date, today: Date): AttendanceRecord[] {
  if (sameDay(day, today)) {
    const nowMin = Math.min(today.getHours() * 60 + today.getMinutes(), SHIFT_END_MIN)
    return baCheckInOutByStore.flatMap((row) => {
      const checkInMin = clockToMinutes(row.checkIn)
      if (checkInMin === null) return []
      const checkOutMin = clockToMinutes(row.checkOut)
      const hours = Math.max(0, ((checkOutMin ?? nowMin) - checkInMin) / 60)
      return [{ ba: row.ba, store: row.store, city: row.city, date: day, checkInMin, checkOutMin, hours }]
    })
  }

  return baCheckInOutByStore.flatMap((row, i) => {
    const h = hash(dayKey(day), i + 100)
    if (h % 100 < 12) return [] // absent
    const checkInMin = SHIFT_START_MIN + ((h >>> 8) % 75)
    const workMin = 6.5 * 60 + ((h >>> 16) % 240)
    const checkOutMin = Math.min(checkInMin + workMin, SHIFT_END_MIN)
    return [
      {
        ba: row.ba,
        store: row.store,
        city: row.city,
        date: day,
        checkInMin,
        checkOutMin,
        hours: (checkOutMin - checkInMin) / 60,
      },
    ]
  })
}

export function attendanceForRange(range: DateRange, today = new Date()) {
  return eachDay(range).flatMap((d) => recordsForDay(d, today))
}

export type AttendanceRow = {
  ba: string
  store: string
  city: string
  /** Days worked in the range (1 for a single day) */
  days: number
  checkIn: string
  checkOut: string
  hours: number
  /** Only for a single day */
  status: 'Active' | 'Checked Out' | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** One row per BA visit for a single day; per BA/store averages for longer ranges. */
export function attendanceRows(records: AttendanceRecord[], singleDay: boolean): AttendanceRow[] {
  if (singleDay) {
    return records.map((r) => ({
      ba: r.ba,
      store: r.store,
      city: r.city,
      days: 1,
      checkIn: formatClock(r.checkInMin),
      checkOut: r.checkOutMin === null ? '—' : formatClock(r.checkOutMin),
      hours: r.hours,
      status: r.checkOutMin === null ? 'Active' : 'Checked Out',
    }))
  }

  const groups = new Map<string, AttendanceRecord[]>()
  for (const r of records) {
    const key = `${r.ba}|${r.store}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.values()].map((rs) => {
    const checkIn = avg(rs.map((r) => r.checkInMin))
    const checkOut = avg(rs.flatMap((r) => (r.checkOutMin === null ? [] : [r.checkOutMin])))
    return {
      ba: rs[0].ba,
      store: rs[0].store,
      city: rs[0].city,
      days: rs.length,
      checkIn: checkIn === null ? '—' : formatClock(checkIn),
      checkOut: checkOut === null ? '—' : formatClock(checkOut),
      hours: avg(rs.map((r) => r.hours)) ?? 0,
      status: null,
    }
  })
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type WorkingHoursPoint = { label: string; hours: number; count: number }

/**
 * Average working hours per BA visit, optionally for one city.
 * One day → per store; up to 31 days → per day; longer → per month.
 */
export function workingHoursSeries(records: AttendanceRecord[], range: DateRange, cities: string[]) {
  const rows = cities.length ? records.filter((r) => cities.includes(r.city)) : records
  const days = daysInRange(range)

  const bucket = (r: AttendanceRecord) =>
    days === 1
      ? r.store
      : days <= 31
        ? `${r.date.getDate()} ${MONTHS_SHORT[r.date.getMonth()]}`
        : `${MONTHS_SHORT[r.date.getMonth()]} ${String(r.date.getFullYear()).slice(2)}`

  const groups = new Map<string, number[]>()
  for (const r of rows) groups.set(bucket(r), [...(groups.get(bucket(r)) ?? []), r.hours])

  const points = [...groups.entries()].map<WorkingHoursPoint>(([label, hs]) => ({
    label,
    hours: Math.round((avg(hs) ?? 0) * 10) / 10,
    count: hs.length,
  }))
  const overall = avg(rows.map((r) => r.hours))

  return { points, avgHours: overall === null ? null : Math.round(overall * 10) / 10 }
}
