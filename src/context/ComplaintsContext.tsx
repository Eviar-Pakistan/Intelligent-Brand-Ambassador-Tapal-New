import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  initialComplaints,
  type BaComplaint,
  type Complaint,
  type ComplaintStatus,
  type CustomerComplaint,
} from '../data/complaints'

type SubmitBaComplaintInput = Omit<BaComplaint, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'hoNote'>

type SubmitCustomerComplaintInput = Omit<
  CustomerComplaint,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'hoNote'
>

export type SubmitComplaintInput = SubmitBaComplaintInput | SubmitCustomerComplaintInput

type ComplaintsContextValue = {
  complaints: Complaint[]
  submitComplaint: (input: SubmitComplaintInput) => Complaint
  updateComplaintStatus: (id: string, status: ComplaintStatus, hoNote?: string) => void
}

const ComplaintsContext = createContext<ComplaintsContextValue | null>(null)

const STORAGE_KEY = 'complaints-v1'

function loadComplaints(): Complaint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return initialComplaints
    const stored = parsed.filter(
      (c): c is Complaint =>
        !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.storeId === 'number',
    )
    const ids = new Set(stored.map((c) => c.id))
    return [...stored, ...initialComplaints.filter((c) => !ids.has(c.id))]
  } catch {
    return initialComplaints
  }
}

export function ComplaintsProvider({ children }: { children: ReactNode }) {
  const [complaints, setComplaints] = useState<Complaint[]>(loadComplaints)

  const persist = useCallback((next: Complaint[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // keep the in-memory list for this session
    }
    return next
  }, [])

  const submitComplaint = useCallback((input: SubmitComplaintInput) => {
    const now = new Date().toISOString()
    let created!: Complaint
    setComplaints((prev) => {
      created = {
        ...input,
        id: `cmp-${1000 + prev.length + 1}`,
        status: 'Open',
        createdAt: now,
        updatedAt: now,
      }
      return persist([created, ...prev])
    })
    return created
  }, [persist])

  const updateComplaintStatus = useCallback(
    (id: string, status: ComplaintStatus, hoNote?: string) => {
      const now = new Date().toISOString()
      setComplaints((prev) =>
        persist(
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status,
                  updatedAt: now,
                  ...(hoNote !== undefined ? { hoNote } : {}),
                }
              : c,
          ),
        ),
      )
    },
    [persist],
  )

  const value = useMemo(
    () => ({ complaints, submitComplaint, updateComplaintStatus }),
    [complaints, submitComplaint, updateComplaintStatus],
  )

  return <ComplaintsContext.Provider value={value}>{children}</ComplaintsContext.Provider>
}

export function useComplaints() {
  const ctx = useContext(ComplaintsContext)
  if (!ctx) throw new Error('useComplaints must be used within ComplaintsProvider')
  return ctx
}
