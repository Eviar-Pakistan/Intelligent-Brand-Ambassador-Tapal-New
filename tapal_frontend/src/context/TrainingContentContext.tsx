import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { SERVER_SYNC_EVENT } from '../lib/serverSyncEvent'

/** Modules from the server (the active training video) have ids starting with this. */
const SERVER_MODULE_PREFIX = 'tv-'

export type AssessmentQuestion = {
  id: string
  prompt: string
}

export type TrainingModule = {
  id: string
  title: string
  description: string
  videoName: string
  videoUrl: string
  questions: AssessmentQuestion[]
  createdAt: string
}

type TrainingContentContextValue = {
  modules: TrainingModule[]
  addModule: (
    module: Omit<TrainingModule, 'id' | 'createdAt'>,
    videoFile?: File,
  ) => TrainingModule
  removeModule: (id: string) => void
}

const TrainingContentContext = createContext<TrainingContentContextValue | null>(null)

const REMOVED_MODULE_IDS = new Set(['tm-builtin-tapal'])

function isRemovedSample(module: { id?: string; builtin?: boolean; title?: string }) {
  return !!module.builtin || REMOVED_MODULE_IDS.has(module.id ?? '') || module.title === 'Tapal Tea knowledge'
}

// ─── Persistence ─────────────────────────────────────────────────────────────
// Module text lives in localStorage; the video files live in IndexedDB. Together they let a
// training link opened in a new tab (or after a reload) still find the uploaded video.

const META_KEY = 'ba-training-modules-v1'
const DB_NAME = 'ba-training-videos'
const STORE = 'videos'

type StoredModule = Omit<TrainingModule, 'videoUrl'> & { hasVideo: boolean; builtin?: boolean }

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const saveVideo = (id: string, file: Blob) => withStore('readwrite', (s) => s.put(file, id))
const loadVideo = (id: string) => withStore<Blob | undefined>('readonly', (s) => s.get(id))
const deleteVideo = (id: string) => withStore('readwrite', (s) => s.delete(id))

function readStoredModules(): StoredModule[] | null {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? (JSON.parse(raw) as StoredModule[]) : null
  } catch {
    return null
  }
}

export function TrainingContentProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<TrainingModule[]>([])
  const hydrated = useRef(false)

  useEffect(() => {
    let cancelled = false
    const stored = readStoredModules()?.filter((m) => !isRemovedSample(m)) ?? null
    if (!stored) {
      hydrated.current = true
      return
    }
    Promise.all(
      stored.map(async ({ hasVideo, ...m }): Promise<TrainingModule> => {
        let videoUrl = ''
        if (hasVideo) {
          try {
            const blob = await loadVideo(m.id)
            if (blob) videoUrl = URL.createObjectURL(blob)
          } catch {
            // video unavailable — the module still shows without it
          }
        }
        return { ...m, videoUrl }
      }),
    ).then((restored) => {
      if (cancelled) return
      hydrated.current = true
      setModules(restored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The active training video Head Office uploaded, with its questions, on every device.
  useEffect(() => {
    let cancelled = false
    async function sync() {
      try {
        const response = await fetch('/api/ba/training/modules/')
        if (!response.ok) return
        const data = (await response.json()) as { results?: TrainingModule[] }
        const server = Array.isArray(data.results) ? data.results : []
        if (cancelled) return
        const names = new Set(server.map((m) => m.videoName))
        setModules((prev) => [
          ...server,
          ...prev.filter((m) => !m.id.startsWith(SERVER_MODULE_PREFIX) && !names.has(m.videoName)),
        ])
      } catch {
        // keep the modules already on screen
      }
    }
    void sync()
    window.addEventListener(SERVER_SYNC_EVENT, sync)
    return () => {
      cancelled = true
      window.removeEventListener(SERVER_SYNC_EVENT, sync)
    }
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    try {
      const meta: StoredModule[] = modules
        .filter((m) => !isRemovedSample(m) && !m.id.startsWith(SERVER_MODULE_PREFIX))
        .map(({ videoUrl, ...m }) => ({ ...m, hasVideo: !!videoUrl }))
      localStorage.setItem(META_KEY, JSON.stringify(meta))
    } catch {
      // storage unavailable — modules stay in memory for this session
    }
  }, [modules])

  const addModule = useCallback(
    (module: Omit<TrainingModule, 'id' | 'createdAt'>, videoFile?: File) => {
      const next: TrainingModule = {
        ...module,
        id: `tm-${Date.now()}`,
        createdAt: new Date().toISOString(),
      }
      if (videoFile) saveVideo(next.id, videoFile).catch(() => {})
      setModules((prev) => [next, ...prev])
      return next
    },
    [],
  )

  const removeModule = useCallback((id: string) => {
    setModules((prev) => {
      const target = prev.find((m) => m.id === id)
      if (!target) return prev
      deleteVideo(id).catch(() => {})
      if (target.videoUrl) URL.revokeObjectURL(target.videoUrl)
      return prev.filter((m) => m.id !== id)
    })
  }, [])

  const value = useMemo(
    () => ({ modules, addModule, removeModule }),
    [modules, addModule, removeModule],
  )

  return (
    <TrainingContentContext.Provider value={value}>{children}</TrainingContentContext.Provider>
  )
}

export function useTrainingContent() {
  const ctx = useContext(TrainingContentContext)
  if (!ctx) throw new Error('useTrainingContent must be used within TrainingContentProvider')
  return ctx
}
