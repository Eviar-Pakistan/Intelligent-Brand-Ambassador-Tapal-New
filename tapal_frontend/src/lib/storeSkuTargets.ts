import { djangoFetch, djangoToken } from './djangoApi'

/**
 * The store SKU target sheet: Region | City | Store name | Brand | SKU Name | KG Count | Count | Grammage.
 * The server matches each store, gives its SKU targets to that store's BA(s) for the month, and saves them.
 */

export type StoreSkuUploadResult = {
  month: string
  saved: { baName: string; baCode: string; store: string; targetKg: number }[]
  stores: string[]
  unmatched_stores: string[]
  stores_without_ba: string[]
  stores_with_empty_kg: string[]
  row_problems: string[]
}

const norm = (value: unknown) => String(value ?? '').replace(/\*/g, '').trim().toLowerCase()

/** True when the file is the store SKU sheet (has Store name, SKU Name and KG Count columns). */
export async function isStoreSkuSheet(file: File) {
  try {
    const XLSX = await import('xlsx')
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array', sheetRows: 1 })
    const header = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1 })[0] ?? []
    const names = new Set(header.map(norm))
    return names.has('store name') && names.has('sku name') && names.has('kg count')
  } catch {
    return false
  }
}

/** Plain-language lines describing what was saved and what was skipped. */
export function describeSkuUpload(result: StoreSkuUploadResult) {
  const problems: string[] = []
  for (const name of result.unmatched_stores) problems.push(`No store named "${name}" (check the name in Stores).`)
  for (const name of result.stores_without_ba)
    problems.push(`${name}: no BA has a shift there this month or is deployed there.`)
  for (const name of result.stores_with_empty_kg) problems.push(`${name}: KG Count is empty.`)
  return [...problems, ...result.row_problems]
}

export async function uploadStoreSkuTargets(file: File, month: string): Promise<StoreSkuUploadResult> {
  if (!djangoToken()) throw new Error('Sign in to Head Office to save targets.')
  const body = new FormData()
  body.append('file', file)
  body.append('month', month)
  const response = await djangoFetch('/api/ba-targets/upload/', { method: 'POST', body })
  const data = (await response.json().catch(() => ({}))) as Partial<StoreSkuUploadResult> & { detail?: string }
  if (!response.ok && !data.saved) throw new Error(data.detail || 'The targets could not be saved.')
  return {
    month: data.month ?? month,
    saved: data.saved ?? [],
    stores: data.stores ?? [],
    unmatched_stores: data.unmatched_stores ?? [],
    stores_without_ba: data.stores_without_ba ?? [],
    stores_with_empty_kg: data.stores_with_empty_kg ?? [],
    row_problems: data.row_problems ?? [],
  }
}
