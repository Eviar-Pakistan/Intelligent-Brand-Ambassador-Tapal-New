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
let syncActive = false

/** Everything that mirrors server data, for whichever part of the app is open. */
async function syncEverything() {
  const portal = currentPortal()
  if (portal === 'shopper') return
  if (portal === 'office' && !djangoToken()) return
  if (portal === 'ba' && !baServerToken()) return
  if (portal === 'supervisor' && !supervisorToken() && !djangoToken()) return
  if (syncActive) return
  syncActive = true

  try {
    const tasks: Promise<unknown>[] = [syncKpiConfig()]
    if (portal === 'ba') tasks.push(syncBaStores())
    // Supervisor overview sync calculates rankings and store metrics. Keep it off the
    // general dashboard refresh; fetch it only in supervisor workflows.
    const path = window.location.pathname
    const supervisorWorkflow = portal === 'supervisor' || /^\/(ho|admin)\/supervisors(?:\/|$)/.test(path)
    if (supervisorWorkflow) tasks.push(syncSupervisors())
    tasks.push(syncJourney(), syncDailyReports(), syncInterceptions(), syncEarlyCheckouts())
    if (portal === 'supervisor') tasks.push(syncSupervisorNotifications())
    await Promise.all(tasks)
    requestServerSync()
  } finally {
    syncActive = false
  }
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
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') void syncEverything()
    }
    const id = window.setInterval(syncWhenVisible, REFRESH_MS)
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [])

  return null
}
