import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { djangoToken } from '../lib/djangoApi'
import { baServerToken, currentPortal, portalGet, portalSend, resultsOf } from '../lib/serverApi'
import { SERVER_SYNC_EVENT } from '../lib/serverSyncEvent'
import {
  initialComplaints,
  isSampleComplaint,
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

/** Unique across devices, so complaints filed on different phones never share an id. */
function newComplaintId() {
  return `cmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Complaints are kept on the server (/api/complaints/): a BA files them with their account link,
 * Head Office reviews them, a supervisor sees those from their stores. This list mirrors the server;
 * a complaint that could not be sent yet stays here and is sent again on the next sync.
 */
async function sendComplaint(complaint: Complaint): Promise<Complaint | null> {
  const token = baServerToken()
  if (!token) return null
  try {
    return await portalSend<Complaint>('/api/complaints/', 'POST', { ...complaint, token }, 'ba')
  } catch (error) {
    console.warn('[complaints] not sent yet:', error instanceof Error ? error.message : error)
    return null
  }
}

function loadComplaints(): Complaint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return initialComplaints
    const stored = parsed.filter(
      (c): c is Complaint =>
        !!c &&
        typeof c === 'object' &&
        typeof c.id === 'string' &&
        typeof c.storeId === 'number' &&
        !isSampleComplaint(c.id),
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

  const replaceWith = useCallback(
    (saved: Complaint) => setComplaints((prev) => persist([saved, ...prev.filter((c) => c.id !== saved.id)])),
    [persist],
  )

  // Load from the server: Head Office sees all, a supervisor their stores, a BA re-sends what is pending.
  useEffect(() => {
    let cancelled = false
    async function sync() {
      const portal = currentPortal()
      if (portal === 'ba') {
        for (const complaint of loadComplaints().filter((c) => c.unsent)) {
          const saved = await sendComplaint(complaint)
          if (saved && !cancelled) replaceWith(saved)
        }
        return
      }
      if (portal === 'shopper' || (portal === 'office' && !djangoToken())) return
      const rows = resultsOf(await portalGet<{ results: Complaint[] }>('/api/complaints/', portal))
      if (!rows || cancelled) return
      setComplaints((prev) =>
        persist([...rows, ...prev.filter((c) => c.unsent && !rows.some((r) => r.id === c.id))]),
      )
    }
    void sync()
    window.addEventListener(SERVER_SYNC_EVENT, sync)
    return () => {
      cancelled = true
      window.removeEventListener(SERVER_SYNC_EVENT, sync)
    }
  }, [persist, replaceWith])

  const submitComplaint = useCallback((input: SubmitComplaintInput) => {
    const now = new Date().toISOString()
    let created!: Complaint
    setComplaints((prev) => {
      created = {
        ...input,
        id: newComplaintId(),
        status: 'Open',
        createdAt: now,
        updatedAt: now,
      }
      return persist([{ ...created, unsent: true }, ...prev])
    })
    void sendComplaint(created).then((saved) => saved && replaceWith(saved))
    return created
  }, [persist, replaceWith])

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
      if (djangoToken() && currentPortal() === 'office') {
        void portalSend<Complaint>(
          `/api/complaints/${encodeURIComponent(id)}/`,
          'PATCH',
          { status, ...(hoNote !== undefined ? { hoNote } : {}) },
          'office',
        )
          .then((saved) => saved && replaceWith(saved))
          .catch((error) => console.warn('[complaints] status not saved:', error instanceof Error ? error.message : error))
      }
    },
    [persist, replaceWith],
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
