export type BaLocation = { latitude: number; longitude: number; accuracy: number | null }

/** Shown when the phone gives no position: check-in and check-out are refused without one. */
export const LOCATION_REQUIRED_MESSAGE =
  'Your location is required. Turn on location (GPS), allow it for this app, then try again.'

function readPosition(highAccuracy: boolean, timeoutMs: number): Promise<BaLocation | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs + 1_000)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer)
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
        })
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}

/**
 * The phone's current position, for check-in and check-out (both are refused without it).
 * GPS is tried first; inside a store it often gets no fix, so the network position is tried next.
 * Resolves to null when the browser has no location, the BA denies permission, or both take too long.
 */
export async function getBaLocation(timeoutMs = 10_000): Promise<BaLocation | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null
  return (await readPosition(true, timeoutMs)) ?? (await readPosition(false, timeoutMs))
}
