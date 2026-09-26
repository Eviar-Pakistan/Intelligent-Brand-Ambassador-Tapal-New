import { useSyncExternalStore } from 'react'

/**
 * Weekly store visits Head Office schedules for a supervisor, and the visit the supervisor
 * completes on site (location, selfie, BA photo, stock photo). Stored in this browser.
 */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export type JourneyStop = {
  day: Weekday
  storeId: number
}

export type JourneyPlan = {
  id: string
  supervisorId: string
  /** Monday of the planned week, YYYY-MM-DD */
  weekStart: string
  stops: JourneyStop[]
  createdAt: string
  updatedAt: string
}

export type JourneyVisit = {
  id: string
  supervisorId: string
  weekStart: string
  day: Weekday
  storeId: number
  latitude: number
  longitude: number
  accuracy: number | null
  selfie: string
  baPhoto: string
  stockPhoto: string
  completedAt: string
}

const PLANS_KEY = 'supervisor-journey-plans-v1'
const VISITS_KEY = 'supervisor-journey-visits-v1'
const weekdaySet = new Set<string>(WEEKDAYS)

export function toDateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

export function mondayOf(date: Date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  return next
}

export function currentWeekStart(now = new Date()) {
  return toDateKey(mondayOf(now))
}

export function shiftWeek(weekStart: string, deltaWeeks: number) {
  const date = parseDateKey(weekStart)
  date.setDate(date.getDate() + deltaWeeks * 7)
  return toDateKey(date)
}

export function weekStartFromDateInput(value: string) {
  return toDateKey(mondayOf(parseDateKey(value)))
}

export function formatWeekLabel(weekStart: string) {
  const start = parseDateKey(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)} ${end.getFullYear()}`
}

export function weekdayOf(date = new Date()): Weekday {
  const index = date.getDay()
  return WEEKDAYS[index === 0 ? 6 : index - 1]
}

export function sortStops(stops: JourneyStop[]) {
  return [...stops].sort(
    (a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.storeId - b.storeId,
  )
}

function isStop(value: unknown): value is JourneyStop {
  if (!value || typeof value !== 'object') return false
  const row = value as JourneyStop
  return weekdaySet.has(row.day) && typeof row.storeId === 'number'
}

function isPlan(value: unknown): value is JourneyPlan {
  if (!value || typeof value !== 'object') return false
  const row = value as JourneyPlan
  return (
    typeof row.id === 'string' &&
    typeof row.supervisorId === 'string' &&
    typeof row.weekStart === 'string' &&
    Array.isArray(row.stops) &&
    row.stops.every(isStop)
  )
}

function isVisit(value: unknown): value is JourneyVisit {
  if (!value || typeof value !== 'object') return false
  const row = value as JourneyVisit
  return (
    typeof row.id === 'string' &&
    typeof row.supervisorId === 'string' &&
    typeof row.weekStart === 'string' &&
    weekdaySet.has(row.day) &&
    typeof row.storeId === 'number' &&
    typeof row.latitude === 'number' &&
    typeof row.longitude === 'number' &&
    typeof row.selfie === 'string' &&
    typeof row.baPhoto === 'string' &&
    typeof row.stockPhoto === 'string'
  )
}

function readList<T>(key: string, guard: (value: unknown) => value is T): T[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(guard) : null
  } catch {
    return null
  }
}

function seedPlans(): JourneyPlan[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'plan-imran-current',
      supervisorId: 'sup-imran',
      weekStart: currentWeekStart(),
      stops: [
        { day: 'Mon', storeId: 12 },
        { day: 'Wed', storeId: 4 },
        { day: 'Sat', storeId: 12 },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ]
}

let plans = readList(PLANS_KEY, isPlan) ?? seedPlans()
let visits = readList(VISITS_KEY, isVisit) ?? []
const planListeners = new Set<() => void>()
const visitListeners = new Set<() => void>()

function commitPlans(next: JourneyPlan[]) {
  plans = next
  try {
    localStorage.setItem(PLANS_KEY, JSON.stringify(plans))
  } catch {
    // keep the in-memory list when the browser storage is full
  }
  planListeners.forEach((listener) => listener())
}

function commitVisits(next: JourneyVisit[]) {
  visits = next
  try {
    localStorage.setItem(VISITS_KEY, JSON.stringify(visits))
  } catch {
    // keep the in-memory list when the browser storage is full
  }
  visitListeners.forEach((listener) => listener())
}

function subscribePlans(listener: () => void) {
  planListeners.add(listener)
  return () => planListeners.delete(listener)
}

function subscribeVisits(listener: () => void) {
  visitListeners.add(listener)
  return () => visitListeners.delete(listener)
}

export function useJourneyPlans() {
  return useSyncExternalStore(subscribePlans, () => plans, () => plans)
}

export function useJourneyVisits() {
  return useSyncExternalStore(subscribeVisits, () => visits, () => visits)
}

export function planFor(supervisorId: string, weekStart: string) {
  return plans.find((plan) => plan.supervisorId === supervisorId && plan.weekStart === weekStart) ?? null
}

export function visitFor(supervisorId: string, weekStart: string, stop: JourneyStop) {
  return (
    visits.find(
      (visit) =>
        visit.supervisorId === supervisorId &&
        visit.weekStart === weekStart &&
        visit.day === stop.day &&
        visit.storeId === stop.storeId,
    ) ?? null
  )
}

/** Replaces the week’s stops. An empty list removes the plan. */
export function saveJourneyPlan(supervisorId: string, weekStart: string, stops: JourneyStop[]) {
  const cleaned = sortStops(
    stops.filter((stop, index, list) => list.findIndex((item) => item.day === stop.day && item.storeId === stop.storeId) === index),
  )
  const rest = plans.filter((plan) => !(plan.supervisorId === supervisorId && plan.weekStart === weekStart))
  if (cleaned.length === 0) {
    commitPlans(rest)
    return null
  }
  const existing = plans.find((plan) => plan.supervisorId === supervisorId && plan.weekStart === weekStart)
  const now = new Date().toISOString()
  const next: JourneyPlan = {
    id: existing?.id ?? `plan-${Date.now().toString(36)}`,
    supervisorId,
    weekStart,
    stops: cleaned,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  commitPlans([next, ...rest])
  return next
}

export function completeVisit(input: Omit<JourneyVisit, 'id' | 'completedAt'>) {
  const same = (visit: JourneyVisit) =>
    visit.supervisorId === input.supervisorId &&
    visit.weekStart === input.weekStart &&
    visit.day === input.day &&
    visit.storeId === input.storeId
  const existing = visits.find(same)
  const next: JourneyVisit = {
    ...input,
    id: existing?.id ?? `visit-${Date.now().toString(36)}`,
    completedAt: new Date().toISOString(),
  }
  commitVisits([next, ...visits.filter((visit) => !same(visit))])
  return next
}
