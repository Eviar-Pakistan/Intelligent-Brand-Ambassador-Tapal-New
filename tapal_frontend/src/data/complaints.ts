import { groupByRange, loadSkuCatalogue, type SkuRange } from '../lib/skuCatalogue'
export type ComplaintStatus = 'Open' | 'In Review' | 'Resolved' | 'Rejected'

export type ComplaintKind = 'customer' | 'ba'

export type ComplaintCategory =
  | 'Store facilities'
  | 'Product stock'
  | 'Staff / management'
  | 'Safety / security'
  | 'Schedule / deployment'
  | 'Other'

/** Customer complaints are about Tapal products only. */
export const COMPLAINT_BRAND = 'Tapal'

export type { SkuRange }

/** Every Tapal SKU grouped by range (Danedar, Tezdum…), from the server's SKU catalogue. */
export async function loadComplaintSkus(): Promise<SkuRange[]> {
  return groupByRange(await loadSkuCatalogue())
}

type ComplaintBase = {
  id: string
  baId: string
  baName: string
  storeId: number
  storeName: string
  city: string
  status: ComplaintStatus
  createdAt: string
  updatedAt: string
  hoNote?: string
  /** Filed on this device but not accepted by the server yet; sent again on the next sync. */
  unsent?: boolean
}

export type CustomerComplaint = ComplaintBase & {
  kind: 'customer'
  brand: string
  sku: string
  customerName: string
  customerNumber: string
  complaint: string
  /** Compressed image attached by the BA, when the customer provided one. */
  image?: string
}

export type BaComplaint = ComplaintBase & {
  kind: 'ba'
  category: ComplaintCategory
  subject: string
  details: string
}

export type Complaint = CustomerComplaint | BaComplaint

export const complaintCategories: ComplaintCategory[] = [
  'Store facilities',
  'Product stock',
  'Staff / management',
  'Safety / security',
  'Schedule / deployment',
  'Other',
]

export const initialComplaints: Complaint[] = []

const SAMPLE_COMPLAINT_IDS = new Set([
  'cmp-1001',
  'cmp-1002',
  'cmp-1003',
  'cmp-1004',
  'cmp-1005',
  'cmp-1006',
])

export function isSampleComplaint(id: string) {
  return SAMPLE_COMPLAINT_IDS.has(id)
}

export function formatComplaintDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
