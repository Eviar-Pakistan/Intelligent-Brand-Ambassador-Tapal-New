import { useSyncExternalStore } from 'react'

/** A shopper a brand ambassador spoke with during a store visit. */
export type UserInterception = {
  id: string
  baId: string
  baName: string
  storeId: number | null
  storeName: string
  name: string
  contact: string
  cityArea: string
  previousBrand: string
  previousSku: string
  currentSku: string
  feedback: string
  createdAt: string
}

const STORAGE_KEY = 'ba-user-interceptions-v1'

function load(): UserInterception[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is UserInterception =>
        !!row &&
        typeof row.id === 'string' &&
        typeof row.baId === 'string' &&
        typeof row.name === 'string' &&
        typeof row.contact === 'string' &&
        typeof row.cityArea === 'string' &&
        typeof row.previousBrand === 'string' &&
        typeof row.previousSku === 'string' &&
        typeof row.currentSku === 'string' &&
        typeof row.feedback === 'string',
    )
  } catch {
    return []
  }
}

let records = load()
const listeners = new Set<() => void>()

function commit(next: UserInterception[]) {
  records = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // keep the in-memory list
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUserInterceptions() {
  return useSyncExternalStore(subscribe, () => records, () => [])
}

export function submitUserInterception(input: Omit<UserInterception, 'id' | 'createdAt'>) {
  const entry: UserInterception = {
    ...input,
    name: input.name.trim(),
    contact: input.contact.trim(),
    cityArea: input.cityArea.trim(),
    previousBrand: input.previousBrand.trim(),
    previousSku: input.previousSku.trim(),
    currentSku: input.currentSku.trim(),
    feedback: input.feedback.trim(),
    id: `int-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
  }
  commit([entry, ...records].slice(0, 400))
  return entry
}
