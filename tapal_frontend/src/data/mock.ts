export const campaign = {
  id: 'tapal-tea',
  name: 'Tapal Tea — Engagement & Conversion',
  brand: 'Tapal Tea',
  status: 'LIVE' as const,
  start: '01 Aug 2026',
  end: '30 Sep 2026',
  progress: 82,
}

export const campaigns = [
  campaign,
  {
    id: 'premium-tea',
    name: 'Premium Tea Push',
    brand: 'Valley Leaf',
    status: 'PLANNING' as const,
    start: '15 Sep 2026',
    end: '15 Oct 2026',
    progress: 22,
  },
  {
    id: 'spice-blend',
    name: 'Heritage Spices',
    brand: 'Masala Co',
    status: 'COMPLETED' as const,
    start: '01 May 2026',
    end: '30 Jun 2026',
    progress: 100,
  },
]

export const engagementSeries = [
  { day: 'Mon', engagement: 820, conversion: 28 },
  { day: 'Tue', engagement: 940, conversion: 31 },
  { day: 'Wed', engagement: 1100, conversion: 33 },
  { day: 'Thu', engagement: 980, conversion: 30 },
  { day: 'Fri', engagement: 1280, conversion: 36 },
  { day: 'Sat', engagement: 1520, conversion: 39 },
  { day: 'Sun', engagement: 1410, conversion: 37 },
]

export const cities = [
  { city: 'Lahore', stores: 8, shoppers: 5240 },
  { city: 'Karachi', stores: 7, shoppers: 4110 },
  { city: 'Islamabad', stores: 5, shoppers: 2890 },
  { city: 'Rawalpindi', stores: 4, shoppers: 602 },
]

export const consumerInsights = {
  preferredTea: [
    { name: 'Tapal', value: 42 },
    { name: 'Lipton', value: 31 },
    { name: 'Vital', value: 18 },
    { name: 'Others', value: 9 },
  ],
  familySize: [
    { name: '1–2', value: 18 },
    { name: '3–4', value: 44 },
    { name: '5–6', value: 26 },
    { name: '7+', value: 12 },
  ],
  purchaseFrequency: [
    { name: 'Weekly', value: 28 },
    { name: 'Bi-weekly', value: 41 },
    { name: 'Monthly', value: 31 },
  ],
  priceSensitivity: [
    { name: 'High', value: 22 },
    { name: 'Medium', value: 51 },
    { name: 'Low', value: 27 },
  ],
  healthPreference: [
    { name: 'Antioxidants', value: 38 },
    { name: 'Taste first', value: 27 },
    { name: 'Price first', value: 21 },
    { name: 'Brand loyalty', value: 14 },
  ],
}

export type ConsumerStoreQuestion = {
  id: string
  storeId: number
  prompt: string
  responses: number
}

/** Survey questions captured / configured per store */
export const initialConsumerStoreQuestions: ConsumerStoreQuestion[] = [
  {
    id: 'cq1',
    storeId: 12,
    prompt: 'Which tea brand do you currently use at home?',
    responses: 312,
  },
  {
    id: 'cq2',
    storeId: 12,
    prompt: 'How many cups of tea does your household drink daily?',
    responses: 298,
  },
  {
    id: 'cq3',
    storeId: 12,
    prompt: 'What matters most — taste, aroma, or price?',
    responses: 276,
  },
  {
    id: 'cq4',
    storeId: 7,
    prompt: 'How often do you buy tea?',
    responses: 184,
  },
  {
    id: 'cq5',
    storeId: 7,
    prompt: 'Would you try Tapal Tea this visit?',
    responses: 161,
  },
  {
    id: 'cq6',
    storeId: 4,
    prompt: 'Which pack size do you usually buy?',
    responses: 220,
  },
  {
    id: 'cq7',
    storeId: 4,
    prompt: 'Have you heard of Tapal Tea before?',
    responses: 205,
  },
  {
    id: 'cq8',
    storeId: 19,
    prompt: 'How do you usually prepare tea at home?',
    responses: 142,
  },
  {
    id: 'cq9',
    storeId: 19,
    prompt: 'How price-sensitive are you when choosing tea?',
    responses: 138,
  },
  {
    id: 'cq10',
    storeId: 23,
    prompt: 'What stops you from switching tea brands?',
    responses: 96,
  },
]

export const shopperIntel = {
  footfall: '48.2k',
  engagementRate: '68.4%',
  purchaseIntent: '44.1%',
  conversionRate: '31.7%',
}

export const operations = {
  activeBas: 41,
  gpsOnline: 38,
  attendance: '94%',
  storeCoverage: '87%',
}

/** Active BAs aggregated by store (Dashboard) */
export const activeBasByStore: {
  storeId: number
  store: string
  city: string
  active: number
  break: number
  offline: number
  total: number
}[] = []

/** Store-wise BA check-in / check-out log (Dashboard) */
export const baCheckInOutByStore: {
  ba: string
  store: string
  city: string
  checkIn: string
  checkOut: string
  status: string
}[] = []

export const storeRanking: { id: number; name: string; city: string; score: number; conversion: number }[] = []

export const baRanking: { id: string; name: string; points: number; conversion: number; city: string }[] = []

export const aiRecommendations = [
  {
    id: 1,
    pattern: 'High Engagement / Low Conversion',
    store: 'Store #12 — Lahore',
    engagement: 78,
    conversion: 19,
    action: 'Retrain BA on objection handling and reinforce taste comparison script.',
    severity: 'high' as const,
  },
  {
    id: 2,
    pattern: 'High Sales / Low Traffic',
    store: 'Store #07 — Karachi',
    engagement: 52,
    conversion: 41,
    action: 'Increase sampling during weekend peak hours (6–9 PM).',
    severity: 'medium' as const,
  },
  {
    id: 3,
    pattern: 'SKU Opportunity',
    store: 'Campaign-wide',
    engagement: 68,
    conversion: 32,
    action: 'Promote Danedar 475g — highest intent among family-size households.',
    severity: 'medium' as const,
  },
]

export const mapPins = [
  { x: 28, y: 42, level: 'high' as const, label: '#12 Lahore' },
  { x: 18, y: 68, level: 'high' as const, label: '#7 Karachi' },
  { x: 36, y: 28, level: 'medium' as const, label: '#19 Islamabad' },
  { x: 42, y: 48, level: 'medium' as const, label: '#4 Faisalabad' },
  { x: 48, y: 58, level: 'low' as const, label: '#23 Multan' },
  { x: 22, y: 22, level: 'medium' as const, label: '#31 Peshawar' },
]

export type LifecycleStage =
  | 'Recruited'
  | 'AI Screened'
  | 'Certified'
  | 'Trained'
  | 'Deployed'
  | 'Live'

export const ambassadors = [
  {
    id: 'ayesha',
    name: 'Ayesha Khan',
    city: 'Lahore',
    certification: 'A+',
    status: 'Certified' as const,
    deployed: true,
    storeId: 12,
    store: 'Store #12 — Carrefour DHA',
    score: 92,
    readiness: 94,
    points: 1240,
    experience: '2 yrs',
    scores: { product: 96, communication: 91, selling: 94, objection: 89, interaction: 95 },
    lifecycle: ['Recruited', 'AI Screened', 'Certified', 'Trained', 'Deployed', 'Live'] as LifecycleStage[],
    today: { interactions: 47, conversions: 16, rate: 34 },
    checkIn: '08:02 AM',
    checkOut: '—',
    dataFilled: 'Submitted' as const,
  },
  {
    id: 'hamza',
    name: 'Hamza Ali',
    city: 'Karachi',
    certification: 'A',
    status: 'Training' as const,
    deployed: false,
    storeId: null,
    store: '—',
    score: 87,
    readiness: 78,
    points: 1050,
    experience: '1.5 yrs',
    scores: { product: 86, communication: 85, selling: 84, objection: 82, interaction: 88 },
    lifecycle: ['Recruited', 'AI Screened', 'Certified', 'Trained'] as LifecycleStage[],
    today: { interactions: 0, conversions: 0, rate: 0 },
    checkIn: '—',
    checkOut: '—',
    dataFilled: 'Pending' as const,
  },
  {
    id: 'sara',
    name: 'Sara Ahmed',
    city: 'Islamabad',
    certification: 'A+',
    status: 'Deployed' as const,
    deployed: true,
    storeId: 19,
    store: 'Store #19 — Al-Fatah',
    score: 95,
    readiness: 96,
    points: 1180,
    experience: '3 yrs',
    scores: { product: 97, communication: 94, selling: 93, objection: 92, interaction: 96 },
    lifecycle: ['Recruited', 'AI Screened', 'Certified', 'Trained', 'Deployed', 'Live'] as LifecycleStage[],
    today: { interactions: 39, conversions: 14, rate: 36 },
    checkIn: '08:18 AM',
    checkOut: '01:05 PM',
    dataFilled: 'Submitted' as const,
  },
  {
    id: 'fatima',
    name: 'Fatima Noor',
    city: 'Faisalabad',
    certification: 'A+',
    status: 'Certified' as const,
    deployed: true,
    storeId: 4,
    store: 'Store #4 — Metro',
    score: 93,
    readiness: 95,
    points: 980,
    experience: '3 yrs',
    scores: { product: 95, communication: 92, selling: 91, objection: 94, interaction: 90 },
    lifecycle: ['Recruited', 'AI Screened', 'Certified', 'Trained', 'Deployed', 'Live'] as LifecycleStage[],
    today: { interactions: 28, conversions: 9, rate: 32 },
    checkIn: '08:45 AM',
    checkOut: '—',
    dataFilled: 'Incomplete' as const,
  },
  {
    id: 'bilal',
    name: 'Bilal Ahmed',
    city: 'Karachi',
    certification: 'B+',
    status: 'Pending' as const,
    deployed: false,
    storeId: null,
    store: '—',
    score: 79,
    readiness: 64,
    points: 420,
    experience: '8 mo',
    scores: { product: 81, communication: 77, selling: 80, objection: 74, interaction: 82 },
    lifecycle: ['Recruited', 'AI Screened'] as LifecycleStage[],
    today: { interactions: 0, conversions: 0, rate: 0 },
    checkIn: '09:01 AM',
    checkOut: '—',
    dataFilled: 'Pending' as const,
  },
]

export const candidates = [
  {
    id: 'c-ayesha',
    name: 'Ayesha Khan',
    city: 'Lahore',
    knowledge: 92,
    communication: 91,
    selling: 94,
    objection: 89,
    interaction: 95,
    score: 92,
    status: 'Certified' as const,
    recommendation:
      'Candidate demonstrates strong product knowledge and excellent customer interaction skills.',
  },
  {
    id: 'c-hamza',
    name: 'Hamza Ali',
    city: 'Karachi',
    knowledge: 81,
    communication: 85,
    selling: 79,
    objection: 80,
    interaction: 84,
    score: 82,
    status: 'Training' as const,
    recommendation: 'Solid communicator; strengthen selling confidence before floor deployment.',
  },
  {
    id: 'c-sara',
    name: 'Sara Ahmed',
    city: 'Islamabad',
    knowledge: 96,
    communication: 94,
    selling: 92,
    objection: 93,
    interaction: 95,
    score: 94,
    status: 'Certified' as const,
    recommendation: 'Top-tier candidate. Ready for priority store deployment.',
  },
  {
    id: 'c-omar',
    name: 'Omar Sheikh',
    city: 'Lahore',
    knowledge: 74,
    communication: 70,
    selling: 68,
    objection: 65,
    interaction: 72,
    score: 70,
    status: 'Assessed' as const,
    recommendation: 'Below certification threshold. Recommend additional product coaching.',
  },
  {
    id: 'c-nina',
    name: 'Nina Raza',
    city: 'Multan',
    knowledge: 0,
    communication: 0,
    selling: 0,
    objection: 0,
    interaction: 0,
    score: 0,
    status: 'Pending' as const,
    recommendation: 'Awaiting AI assessment session.',
  },
  {
    id: 'c-zain',
    name: 'Zain Malik',
    city: 'Rawalpindi',
    knowledge: 58,
    communication: 62,
    selling: 55,
    objection: 50,
    interaction: 60,
    score: 57,
    status: 'Rejected' as const,
    recommendation: 'Does not meet minimum certification thresholds.',
  },
]

export type Store = {
  id: number
  storeCode: string
  name: string
  city: string
  footfall: 'High' | 'Medium' | 'Low'
  bas: number
  coverage: number
  status: 'Covered' | 'PARTIAL' | 'NEEDS BA' | 'Inactive'
  todayFootfall: number
  engagement: number
  conversion: number
  peak: string[]
  assigned: { id: string; name: string; state: 'Active' | 'Break' | 'Offline' }[]
  qrCode: string
}

/** Stores saved on the server. The list is filled from the API. */
export const stores: Store[] = []



export const faqs = [
  { q: 'Is Tapal Tea healthy?', count: 842 },
  { q: 'Why switch from other brands?', count: 631 },
  { q: 'Best pack for family of 5?', count: 418 },
  { q: 'Good for doodh patti?', count: 390 },
]

export const trainingScenarios = [
  {
    id: 4,
    total: 10,
    prompt: 'Why should I switch from Lipton?',
    model:
      'Lead with respect for habit, then compare taste, aroma, and brew strength, and close with a soft sample-pack trial ask.',
  },
]

export const settingsSections = [
  'General',
  'Certification Rules',
  'Training Scenarios',
  'AI Knowledge',
  'Rewards',
  'Stores',
  'QR Configuration',
  'Users & Roles',
  'Report Templates',
]
