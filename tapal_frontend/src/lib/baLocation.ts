export type BaLocation = { latitude: number; longitude: number; accuracy: number | null }

/**
 * The phone's current GPS position, for check-in and check-out.
 * Resolves to null when the browser has no GPS, the BA denies permission, or it takes too long,
 * so check-in / check-out still go through (just without a location).
 */
export function getBaLocation(timeoutMs = 10_000): Promise<BaLocation | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
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
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}
