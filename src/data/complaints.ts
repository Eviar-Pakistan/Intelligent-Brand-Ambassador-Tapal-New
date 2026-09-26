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

export const initialComplaints: Complaint[] = [
  {
    id: 'cmp-1001',
    kind: 'ba',
    baId: 'hamza',
    baName: 'Hamza Ali',
    storeId: 7,
    storeName: 'Imtiaz Clifton',
    city: 'Karachi',
    category: 'Product stock',
    subject: 'Danedar 475g out of stock on shelf',
    details:
      'Shelf bay for Tapal Danedar 475g has been empty since morning. Asked store staff twice; they said refill expected tomorrow. Sampling impacted.',
    status: 'Open',
    createdAt: '2026-09-14T09:20:00',
    updatedAt: '2026-09-14T09:20:00',
  },
  {
    id: 'cmp-1002',
    kind: 'ba',
    baId: 'sara',
    baName: 'Sara Ahmed',
    storeId: 19,
    storeName: 'Al-Fatah Blue Area',
    city: 'Islamabad',
    category: 'Store facilities',
    subject: 'Demo counter space removed without notice',
    details:
      'Our branded demo counter was moved behind the aisle. No alternate space provided. Hard to intercept shoppers.',
    status: 'In Review',
    createdAt: '2026-09-13T14:05:00',
    updatedAt: '2026-09-14T08:10:00',
    hoNote: 'Coordinating with store manager for repositioning.',
  },
  {
    id: 'cmp-1003',
    kind: 'ba',
    baId: 'fatima',
    baName: 'Fatima Noor',
    storeId: 4,
    storeName: 'Metro Lahore',
    city: 'Lahore',
    category: 'Schedule / deployment',
    subject: 'Shift clash with store peak hours',
    details:
      'Assigned shift ends at 4 PM but peak footfall starts at 6 PM. Requesting evening slot for better conversion.',
    status: 'Resolved',
    createdAt: '2026-09-11T11:40:00',
    updatedAt: '2026-09-12T16:30:00',
    hoNote: 'Shift updated to 2–8 PM effective next roster.',
  },
  {
    id: 'cmp-1004',
    kind: 'ba',
    baId: 'bilal',
    baName: 'Bilal Ahmed',
    storeId: 7,
    storeName: 'Imtiaz Clifton',
    city: 'Karachi',
    category: 'Safety / security',
    subject: 'Wet floor near demo area',
    details:
      'Leak near the demo spot creates slip risk. Reported to store staff; still not cleaned after 40 minutes.',
    status: 'Open',
    createdAt: '2026-09-14T16:15:00',
    updatedAt: '2026-09-14T16:15:00',
  },
  {
    id: 'cmp-1005',
    kind: 'customer',
    baId: 'ayesha',
    baName: 'Ayesha Khan',
    storeId: 12,
    storeName: 'Carrefour DHA',
    city: 'Lahore',
    brand: 'Tapal Danedar',
    sku: 'Danedar 475g',
    customerName: 'Nadia Rahman',
    customerNumber: '03001234567',
    complaint:
      'Seal was already open and the tea smelled stale. Customer asked for a replacement pack.',
    status: 'Open',
    createdAt: '2026-09-15T11:05:00',
    updatedAt: '2026-09-15T11:05:00',
  },
  {
    id: 'cmp-1006',
    kind: 'customer',
    baId: 'sara',
    baName: 'Sara Ahmed',
    storeId: 19,
    storeName: 'Al-Fatah Blue Area',
    city: 'Islamabad',
    brand: 'Tea Bags',
    sku: 'Tea Bags 100s',
    customerName: 'Imran Qureshi',
    customerNumber: '03219876543',
    complaint: 'Two tea bags in the box were empty. Customer wants the batch checked.',
    status: 'In Review',
    createdAt: '2026-09-14T17:40:00',
    updatedAt: '2026-09-15T09:15:00',
    hoNote: 'Batch photo requested from the store.',
  },
]

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
