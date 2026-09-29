import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { syncDailyReports } from '../lib/baReport'
import { djangoToken } from '../lib/djangoApi'
import { syncEarlyCheckouts } from '../lib/earlyCheckouts'
import { syncJourney } from '../lib/journeyPlans'
import { syncKpiConfig } from '../lib/kpiConfig'
import { baServerToken, currentPortal, supervisorToken } from '../lib/serverApi'
import { requestServerSync } from '../lib/serverSyncEvent'
import { syncBaStores } from '../lib/storeRegistry'
import { syncSupervisorNotifications } from '../lib/supervisorNotifications'
import { syncSupervisors } from '../lib/supervisors'
import { syncInterceptions } from '../lib/userInterceptions'

const REFRESH_MS = 60_000

/** Everything that mirrors server data, for whichever part of the app is open. */
async function syncEverything() {
  const portal = currentPortal()
  await syncKpiConfig()
  if (portal === 'shopper') return
  if (portal === 'ba') await syncBaStores()
  if (portal !== 'ba') await syncSupervisors()
  await Promise.all([syncJourney(), syncDailyReports(), syncInterceptions(), syncEarlyCheckouts()])
  if (portal === 'supervisor') await syncSupervisorNotifications()
  requestServerSync()
}

/**
 * Keeps each screen's data in step with the server: on load, whenever the part of the app or
 * the signed-in person changes, and every minute. Renders nothing.
 */
export function ServerSync() {
  const { pathname } = useLocation()
  const lastKey = useRef('')

  useEffect(() => {
    const key = [currentPortal(), djangoToken() ? 'ho' : '', supervisorToken() ?? '', baServerToken() ?? ''].join('|')
    if (key === lastKey.current) return
    lastKey.current = key
    void syncEverything()
  }, [pathname])

  useEffect(() => {
    const id = window.setInterval(() => void syncEverything(), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [])

  return null
}
