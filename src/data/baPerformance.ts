import generated from './baPerformance.generated.json'

/** Towns in source data outside the Tapal Tea programme scope */
const EXCLUDED_TOWNS = new Set(['Daska', 'Muridke'])

export type BaPerformanceRecord = {
  town: string
  month: string
  store: string
  customersIntercepted: number
  productiveCalls: number
  targetKg: number
  salesKg: number
  danedarSales: number
  familyPackSales: number
  teaBagSales: number
  weekSales: { week: number; sales: number }[]
  skuSales: { sku: string; sales: number }[]
}

export const baPerformanceTowns = (generated.towns as string[]).filter((t) => !EXCLUDED_TOWNS.has(t))
export const baPerformanceMonths = generated.months as string[]
export const baPerformanceStoresByTown = Object.fromEntries(
  Object.entries(generated.storesByTown as Record<string, string[]>).filter(
    ([town]) => !EXCLUDED_TOWNS.has(town),
  ),
)
export const baPerformanceRecords = (generated.records as BaPerformanceRecord[]).filter(
  (r) => !EXCLUDED_TOWNS.has(r.town),
)

/** Tapal product / SKU names present in the performance data. */
export const baPerformanceSkus = [
  ...new Set(baPerformanceRecords.flatMap((r) => r.skuSales.map((s) => s.sku))),
].sort((a, b) => a.localeCompare(b))

export type BaPerformanceFilters = {
  /** Empty means every town. */
  towns: string[]
  month: string | null
  /** Empty means every store. */
  stores: string[]
}

export type BaPerformanceAggregate = {
  customersIntercepted: number
  productiveCalls: number
  productivePct: number
  targetKg: number
  salesKg: number
  /** Packs implied by the same achievement rate as kilograms. */
  targetUnits: number
  /** Packs sold, from the SKU lines in the same filtered records. */
  unitsSold: number
  achievementPct: number
  categorySales: { name: string; value: number }[]
  townTargetVsSales: { town: string; target: number; sales: number }
  weekSales: { week: number; sales: number }[]
  topStores: { store: string; sales: number }[]
  topSkus: { sku: string; sales: number }[]
}

export const MONTH_ORDER = [
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

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * The source data is monthly, so day-level figures are derived: each day gets a
 * deterministic weight (0.6–1.4, mean ≈ 1) and takes its share of the month.
 */
function dayWeight(monthIdx: number, day: number) {
  const seed = Math.imul((monthIdx + 1) * 100 + day, 2654435761) >>> 0
  return 0.6 + (((seed >>> 8) % 1000) / 1000) * 0.8
}

export type PeriodShare = {
  /** Fraction of the month's activity (sales, customers, calls) */
  sales: number
  /** Fraction of the month's target (targets accrue evenly per day) */
  target: number
  /** Fraction of the i-th of n weekly buckets that the period covers */
  weekFactor: (index: number, count: number) => number
}

/** Share of `month` covered by the given days of the month (1-based). */
export function periodShareForDays(month: string, days: number[]): PeriodShare {
  const monthIdx = MONTH_ORDER.indexOf(month)
  const dim = DAYS_IN_MONTH[monthIdx] ?? 30
  const weights = Array.from({ length: dim }, (_, i) => dayWeight(monthIdx, i + 1))
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const inRange = new Set(days.map((d) => Math.min(Math.max(d, 1), dim)))
  const rangeWeight = [...inRange].reduce((s, d) => s + weights[d - 1], 0)

  return {
    sales: rangeWeight / totalWeight,
    target: inRange.size / dim,
    weekFactor: (index, count) => {
      let chunk = 0
      let covered = 0
      for (let d = 1; d <= dim; d += 1) {
        if (Math.floor(((d - 1) * count) / dim) !== index) continue
        chunk += weights[d - 1]
        if (inRange.has(d)) covered += weights[d - 1]
      }
      return chunk > 0 ? covered / chunk : 0
    },
  }
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

export function scaleRecordsToPeriod(records: BaPerformanceRecord[], share: PeriodShare) {
  return records.map<BaPerformanceRecord>((r) => {
    const weeks = [...r.weekSales].sort((a, b) => a.week - b.week)
    return {
      ...r,
      customersIntercepted: Math.round(r.customersIntercepted * share.sales),
      productiveCalls: Math.round(r.productiveCalls * share.sales),
      targetKg: r.targetKg * share.target,
      salesKg: r.salesKg * share.sales,
      danedarSales: r.danedarSales * share.sales,
      familyPackSales: r.familyPackSales * share.sales,
      teaBagSales: r.teaBagSales * share.sales,
      weekSales: weeks.flatMap((w, i) => {
        const factor = share.weekFactor(i, weeks.length)
        return factor > 0 ? [{ week: w.week, sales: round1(w.sales * factor) }] : []
      }),
      skuSales: r.skuSales.map((s) => ({ ...s, sales: s.sales * share.sales })),
    }
  })
}

/** Stores in the selected towns that have data in any of `months` (all months when null or empty). */
export function getStoresForTown(towns: string[], months?: string[] | null) {
  const townList = towns.length ? towns : baPerformanceTowns
  const storeSet = new Set<string>()
  for (const t of townList) {
    for (const s of baPerformanceStoresByTown[t] ?? []) storeSet.add(s)
  }
  const stores = [...storeSet].sort()
  const monthList = months?.filter(Boolean) ?? []
  if (!monthList.length) {
    if (!towns.length) {
      const active = new Set(
        baPerformanceRecords.filter((r) => r.store !== '__ALL__').map((r) => r.store),
      )
      return stores.filter((s) => active.has(s))
    }
    return stores
  }
  const active = new Set(
    baPerformanceRecords
      .filter(
        (r) =>
          (!towns.length || towns.includes(r.town)) &&
          monthList.includes(r.month) &&
          r.store !== '__ALL__',
      )
      .map((r) => r.store),
  )
  return stores.filter((s) => active.has(s))
}

export function filterBaPerformanceRecords(filters: BaPerformanceFilters) {
  return baPerformanceRecords.filter((r) => {
    if (filters.towns.length && !filters.towns.includes(r.town)) return false
    if (filters.month && r.month !== filters.month) return false
    if (r.store === '__ALL__') return false
    if (filters.stores.length && !filters.stores.includes(r.store)) return false
    return true
  })
}

/**
 * Keep only the chosen Tapal products. Empty means every SKU.
 * Store-level kg, calls, and weekly sales scale by the share of SKU sales kept.
 */
export function applySkuFilter(records: BaPerformanceRecord[], skus: string[]) {
  if (!skus.length) return records
  const wanted = new Set(skus)
  return records.flatMap((r) => {
    const total = r.skuSales.reduce((sum, sku) => sum + sku.sales, 0)
    const kept = r.skuSales.filter((sku) => wanted.has(sku.sku))
    const keptSum = kept.reduce((sum, sku) => sum + sku.sales, 0)
    if (keptSum <= 0 || total <= 0) return []
    const share = keptSum / total
    return [
      {
        ...r,
        customersIntercepted: Math.round(r.customersIntercepted * share),
        productiveCalls: Math.round(r.productiveCalls * share),
        targetKg: r.targetKg * share,
        salesKg: r.salesKg * share,
        danedarSales: r.danedarSales * share,
        familyPackSales: r.familyPackSales * share,
        teaBagSales: r.teaBagSales * share,
        weekSales: r.weekSales.map((w) => ({ ...w, sales: round1(w.sales * share) })),
        skuSales: kept.map((sku) => ({ ...sku, sales: sku.sales })),
      },
    ]
  })
}

function emptyAggregate(townLabel: string): BaPerformanceAggregate {
  return {
    customersIntercepted: 0,
    productiveCalls: 0,
    productivePct: 0,
    targetKg: 0,
    salesKg: 0,
    targetUnits: 0,
    unitsSold: 0,
    achievementPct: 0,
    categorySales: [],
    townTargetVsSales: { town: townLabel, target: 0, sales: 0 },
    weekSales: [],
    topStores: [],
    topSkus: [],
  }
}

export function aggregateBaPerformance(
  records: BaPerformanceRecord[],
  town: string | null,
): BaPerformanceAggregate {
  const townLabel = town ?? 'All towns'
  if (records.length === 0) return emptyAggregate(townLabel)

  const customersIntercepted = records.reduce((s, r) => s + r.customersIntercepted, 0)
  const productiveCalls = records.reduce((s, r) => s + r.productiveCalls, 0)
  const targetKgRaw = records.reduce((s, r) => s + r.targetKg, 0)
  const salesKgRaw = records.reduce((s, r) => s + r.salesKg, 0)
  const unitsSoldRaw = records.reduce(
    (sum, record) => sum + record.skuSales.reduce((skuSum, sku) => skuSum + sku.sales, 0),
    0,
  )
  const targetKg = Math.round(targetKgRaw)
  const salesKg = Math.round(salesKgRaw * 10) / 10
  const unitsSold = Math.round(unitsSoldRaw)
  const targetUnits = salesKgRaw > 0 ? Math.round(unitsSoldRaw * (targetKgRaw / salesKgRaw)) : 0
  const danedar = Math.round(records.reduce((s, r) => s + r.danedarSales, 0) * 10) / 10
  const familyPack = Math.round(records.reduce((s, r) => s + r.familyPackSales, 0) * 10) / 10
  const teaBags = Math.round(records.reduce((s, r) => s + r.teaBagSales, 0) * 10) / 10

  const weekMap = new Map<number, number>()
  for (const r of records) {
    for (const w of r.weekSales) {
      weekMap.set(w.week, (weekMap.get(w.week) ?? 0) + w.sales)
    }
  }
  const weekSales = [...weekMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, sales]) => ({ week, sales: Math.round(sales * 10) / 10 }))

  const storeMap = new Map<string, number>()
  for (const r of records) {
    storeMap.set(r.store, (storeMap.get(r.store) ?? 0) + r.salesKg)
  }
  const topStores = [...storeMap.entries()]
    .map(([store, sales]) => ({ store, sales: Math.round(sales * 10) / 10 }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10)

  const skuMap = new Map<string, number>()
  for (const r of records) {
    for (const sku of r.skuSales) {
      skuMap.set(sku.sku, (skuMap.get(sku.sku) ?? 0) + sku.sales)
    }
  }
  const topSkus = [...skuMap.entries()]
    .map(([sku, sales]) => ({ sku, sales: Math.round(sales * 10) / 10 }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10)

  return {
    customersIntercepted,
    productiveCalls,
    productivePct:
      customersIntercepted > 0
        ? Math.round((productiveCalls / customersIntercepted) * 100)
        : 0,
    targetKg,
    salesKg,
    targetUnits,
    unitsSold,
    achievementPct: targetKg > 0 ? Math.round((salesKg / targetKg) * 100) : 0,
    categorySales: [
      { name: 'DANEDAR', value: danedar },
      { name: 'FAMILY PACK', value: familyPack },
      { name: 'TEA BAGS', value: teaBags },
    ],
    townTargetVsSales: { town: townLabel, target: targetKg, sales: salesKg },
    weekSales,
    topStores,
    topSkus,
  }
}

/** A month of source data, optionally narrowed to some of its days. */
export type DataPeriod = { month: string | null; share: PeriodShare | null }

/**
 * Splits a date range into the source months it touches. Months without data are skipped
 * (never substituted with another month's figures) and reported in `missing`.
 */
export function periodsForRange(start: Date, end: Date) {
  const byMonth = new Map<number, Set<number>>()
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const days = byMonth.get(d.getMonth()) ?? new Set<number>()
    days.add(d.getDate())
    byMonth.set(d.getMonth(), days)
  }

  const periods: DataPeriod[] = []
  const missing: string[] = []

  for (const [monthIdx, days] of byMonth) {
    const wanted = MONTH_ORDER[monthIdx]
    if (baPerformanceMonths.includes(wanted)) {
      periods.push({ month: wanted, share: periodShareForDays(wanted, [...days]) })
    } else {
      missing.push(wanted)
    }
  }

  return { periods, missing }
}

/** Filtered records for each period, scaled to the days each period covers. */
export function collectPeriodRecords(
  filters: { towns: string[]; stores: string[] },
  periods: DataPeriod[],
) {
  return periods.flatMap((p) => {
    let records = filterBaPerformanceRecords({ ...filters, month: p.month })
    if (records.length === 0 && filters.towns.length === 1 && !filters.stores.length && p.month) {
      const summary = baPerformanceRecords.find(
        (r) => r.town === filters.towns[0] && r.month === p.month && r.store === '__ALL__',
      )
      if (summary) records = [{ ...summary, store: 'Summary' }]
    }
    return p.share ? scaleRecordsToPeriod(records, p.share) : records
  })
}
