import { getKpiConfig, type KpiConfig } from './kpiConfig'
import { getSupervisors, supervisorOverview, type Supervisor } from './supervisors'

export type IncentiveBreakdown = {
  baId: string
  name: string
  city: string
  rank: number
  /** Conversion rate in % */
  conversion: number
  /** Number of sessions (shopper interactions) */
  sessions: number
  base: number
  conversionPay: number
  sessionPay: number
  /** Conversion + sessions (everything except base pay) */
  incentive: number
  totalPkr: number
}

/**
 * Base pay + conversion and session payouts, each paid in proportion to its target:
 * (actual ÷ target) × amount, all from the KPI settings.
 */
export function calculateIncentive(
  input: { baId: string; name: string; city: string; rank: number; conversion: number; sessions: number },
  config: KpiConfig = getKpiConfig(),
): IncentiveBreakdown {
  const base = config.basePay
  const conversionPay = Math.round((input.conversion / config.conversionTarget) * config.conversionAmount)
  const sessionPay = Math.round((input.sessions / config.sessionTarget) * config.sessionAmount)
  const incentive = conversionPay + sessionPay
  return { ...input, base, conversionPay, sessionPay, incentive, totalPkr: base + incentive }
}

export function formatPkr(amount: number) {
  return `Rs. ${amount.toLocaleString('en-PK')}`
}

export function buildIncentiveRoster(config: KpiConfig = getKpiConfig()): IncentiveBreakdown[] {
  void config
  return []
}

export type SupervisorIncentive = {
  supervisorId: string
  name: string
  city: string
  storeCount: number
  baCount: number
  /** Average conversion of the BAs in the supervisor's stores, % */
  teamConversion: number
  /** Average coverage of the supervisor's stores, % */
  coverage: number
  base: number
  conversionPay: number
  coveragePay: number
  /** Conversion + coverage (everything except base pay) */
  incentive: number
  totalPkr: number
}

/**
 * A supervisor earns base pay plus two KPIs measured across their stores — the average
 * conversion of their BAs and the average store coverage — each paid in proportion to its
 * target: (actual ÷ target) × amount.
 */
export function calculateSupervisorIncentive(
  supervisor: Supervisor,
  config: KpiConfig = getKpiConfig(),
): SupervisorIncentive {
  const overview = supervisorOverview(supervisor)
  const conversionPay = Math.round(
    (overview.teamConversion / config.supConversionTarget) * config.supConversionAmount,
  )
  const coveragePay = Math.round((overview.coverage / config.supCoverageTarget) * config.supCoverageAmount)
  return {
    supervisorId: supervisor.id,
    name: supervisor.name,
    city: supervisor.city,
    storeCount: overview.stores.length,
    baCount: new Set(overview.bas.map((b) => b.id)).size,
    teamConversion: overview.teamConversion,
    coverage: overview.coverage,
    base: config.supBasePay,
    conversionPay,
    coveragePay,
    incentive: conversionPay + coveragePay,
    totalPkr: config.supBasePay + conversionPay + coveragePay,
  }
}

export function buildSupervisorRoster(config: KpiConfig = getKpiConfig()) {
  return getSupervisors().map((s) => calculateSupervisorIncentive(s, config))
}
