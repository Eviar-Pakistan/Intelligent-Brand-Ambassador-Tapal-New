import { useSyncExternalStore } from 'react'
import { djangoToken } from './djangoApi'
import { portalSend } from './serverApi'

/**
 * Incentive KPI settings. Head Office sets these in the "Set KPIs" dialog; every incentive
 * figure in the app is calculated from them automatically.
 *
 * Each KPI is set as "when the BA reaches <target>, pay Rs <amount>", and pays in proportion:
 * half the target pays half the amount, double the target pays double.
 */

export type KpiConfig = {
  /** Flat Rs. for the scheduled week */
  basePay: number
  /** Conversion rate (%) that earns `conversionAmount` — e.g. 100 */
  conversionTarget: number
  /** Rs. paid when conversion reaches `conversionTarget` */
  conversionAmount: number
  /** Sessions (shopper interactions) that earn `sessionAmount` */
  sessionTarget: number
  /** Rs. paid when sessions reach `sessionTarget` */
  sessionAmount: number
  /** Supervisor flat pay for the scheduled week */
  supBasePay: number
  /** Average conversion (%) of the BAs in a supervisor's stores that earns `supConversionAmount` */
  supConversionTarget: number
  supConversionAmount: number
  /** Average coverage (%) of a supervisor's stores that earns `supCoverageAmount` */
  supCoverageTarget: number
  supCoverageAmount: number
}

export const DEFAULT_KPI_CONFIG: KpiConfig = {
  basePay: 1_000,
  conversionTarget: 100,
  conversionAmount: 500,
  sessionTarget: 50,
  sessionAmount: 500,
  supBasePay: 2_000,
  supConversionTarget: 100,
  supConversionAmount: 1_000,
  supCoverageTarget: 100,
  supCoverageAmount: 1_000,
}

const STORAGE_KEY = 'ba-kpi-config-v4'

const amount = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
const positive = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback

/** Coerces any stored/edited value into a valid config. */
export function normalizeKpiConfig(raw: unknown): KpiConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<KpiConfig>
  const d = DEFAULT_KPI_CONFIG
  return {
    basePay: amount(c.basePay, d.basePay),
    conversionTarget: positive(c.conversionTarget, d.conversionTarget),
    conversionAmount: amount(c.conversionAmount, d.conversionAmount),
    sessionTarget: positive(c.sessionTarget, d.sessionTarget),
    sessionAmount: amount(c.sessionAmount, d.sessionAmount),
    supBasePay: amount(c.supBasePay, d.supBasePay),
    supConversionTarget: positive(c.supConversionTarget, d.supConversionTarget),
    supConversionAmount: amount(c.supConversionAmount, d.supConversionAmount),
    supCoverageTarget: positive(c.supCoverageTarget, d.supCoverageTarget),
    supCoverageAmount: amount(c.supCoverageAmount, d.supCoverageAmount),
  }
}

function load(): KpiConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return normalizeKpiConfig(JSON.parse(stored))
  } catch {
    // storage unavailable or corrupt — fall back to defaults
  }
  return DEFAULT_KPI_CONFIG
}

let current = load()
const listeners = new Set<() => void>()

export function getKpiConfig() {
  return current
}

function keep(next: KpiConfig) {
  current = normalizeKpiConfig(next)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // keep the in-memory value for this session
  }
  listeners.forEach((l) => l())
}

/** Head Office saves the settings; they are kept on the server so every screen pays the same. */
export function setKpiConfig(next: KpiConfig) {
  keep(next)
  if (djangoToken()) {
    void portalSend<KpiConfig>('/api/kpi-config/', 'PUT', current, 'office')
      .then((saved) => saved && keep(saved))
      .catch((error) => console.warn('[kpi] not saved on the server:', error instanceof Error ? error.message : error))
  }
}

/** Loads the settings Head Office saved (/api/kpi-config/). */
export async function syncKpiConfig() {
  try {
    const response = await fetch('/api/kpi-config/')
    if (response.ok) keep((await response.json()) as KpiConfig)
  } catch {
    // keep the settings already on screen
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useKpiConfig() {
  return useSyncExternalStore(subscribe, getKpiConfig)
}
