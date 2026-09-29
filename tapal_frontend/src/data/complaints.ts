export type ComplaintStatus = 'Open' | 'In Review' | 'Resolved' | 'Rejected'

export type ComplaintKind = 'customer' | 'ba'

export type ComplaintCategory =
  | 'Store facilities'
  | 'Product stock'
  | 'Staff / management'
  | 'Safety / security'
  | 'Schedule / deployment'
  | 'Other'

export type ComplaintBrand = {
  name: string
  skus: string[]
}

/** Product lines and pack sizes a customer complaint can be filed against. */
export const complaintBrands: ComplaintBrand[] = [
  {
    name: 'Tapal Danedar',
    skus: ['Danedar 90g', 'Danedar 190g', 'Danedar 475g', 'Danedar 900g'],
  },
  {
    name: 'Family Pack',
    skus: ['Family Pack 900g', 'Family Carton 5x475g', 'Bulk Tea 2.5kg'],
  },
  {
    name: 'Tea Bags',
    skus: ['Tea Bags 25s', 'Tea Bags 50s', 'Tea Bags 100s', 'Tea Bags 200s'],
  },
  {
    name: 'Specialty',
    skus: ['Green Tea 100g', 'Green Tea 200g', 'Tezdum 250g', 'Flavored Tea 150g'],
  },
]

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
