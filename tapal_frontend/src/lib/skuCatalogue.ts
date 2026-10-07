import { portalGet } from './serverApi'

/** One Tapal SKU from the server's catalogue: range (Danedar, Tezdum…), name and kg per pack. */
export type SkuRow = { range: string; sku: string; grammage: number }

/** SKU names grouped by range, in catalogue order. */
export type SkuRange = { range: string; skus: string[] }

let catalogue: SkuRow[] | null = null

/** Drop the in-memory catalogue so the next load picks up a newly deployed SKU list. */
export function clearSkuCatalogueCache() {
  catalogue = null
}

/** Every Tapal SKU (/api/sku-catalogue/). Empty when the server cannot be reached. */
export async function loadSkuCatalogue(options?: { force?: boolean }): Promise<SkuRow[]> {
  if (catalogue && !options?.force) return catalogue
  const data = await portalGet<{ results: SkuRow[] }>('/api/sku-catalogue/', 'shopper')
  if (!data) return []
  catalogue = data.results
  return catalogue
}

export function groupByRange(rows: SkuRow[]): SkuRange[] {
  const byRange = new Map<string, string[]>()
  for (const row of rows) byRange.set(row.range, [...(byRange.get(row.range) ?? []), row.sku])
  return [...byRange.entries()].map(([range, skus]) => ({ range, skus }))
}
