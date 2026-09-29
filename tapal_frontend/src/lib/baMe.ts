import { useEffect, useState } from 'react'
import type { BaMonthTarget } from './baTargets'
import { portalGet } from './serverApi'
import { SERVER_SYNC_EVENT } from './serverSyncEvent'

/** The signed-in BA's own numbers from the server (/api/ba/me/): Rewards page and Home goals. */
export type BaMe = {
  name: string
  baCode: string
  status: string
  certified: boolean
  city: string
  storeName: string
  rank: number | null
  rankedOutOf: number
  points: number
  conversion: number
  weekSessions: number
  monthTarget: BaMonthTarget | null
  daysWorked: number
  rating: number | null
  ratingCount: number
  today: { interceptions: number; switched: number; dailyGoal: number }
}

const REFRESH_MS = 60_000

/** Null until loaded, and for sample accounts with no server record. */
export function useBaMe() {
  const [me, setMe] = useState<BaMe | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = () =>
      void portalGet<BaMe>('/api/ba/me/', 'ba').then((data) => {
        if (!cancelled && data) setMe(data)
      })
    load()
    const id = window.setInterval(load, REFRESH_MS)
    window.addEventListener(SERVER_SYNC_EVENT, load)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener(SERVER_SYNC_EVENT, load)
    }
  }, [])
  return me
}

/** "Certified", "In training"… from the server status. */
export function baStatusLabel(status: string | undefined) {
  switch (status) {
    case 'Certified':
      return 'Certified'
    case 'Deployed':
      return 'Certified · Deployed'
    case 'Assessed':
      return 'Assessed'
    case 'Rejected':
      return 'Retraining'
    case 'Training':
      return 'In training'
    default:
      return 'New ambassador'
  }
}
