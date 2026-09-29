import { useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { enterShopperStore, resolveShopperStore } from '../../lib/storeRegistry'
import { LoginPage } from '../LoginPage'

/** What a store's QR code opens: remember which store this shopper is at, then start the journey. */
export function ShopperStoreEntry() {
  const { storeSlug = '' } = useParams()
  const [params] = useSearchParams()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    enterShopperStore(storeSlug, params)
    // The store list is not on a shopper's phone: confirm the store on the server, then continue.
    void resolveShopperStore(storeSlug).finally(() => setReady(true))
  }, [storeSlug, params])
  if (!ready) return null
  return <Navigate to="/shopper" replace />
}

/**
 * The front page. A shopper's QR link can arrive here when the server bounces /shopper/<code>
 * (as `?go=/shopper/<code>?store=…`, or `?store=<code>` from older links): open the shopper page.
 * Everyone else sees the sign-in page.
 */
export function RootEntry() {
  const [params] = useSearchParams()
  const go = params.get('go') ?? ''
  if (go.startsWith('/shopper/')) return <Navigate to={go} replace />
  const legacyStore = params.get('store') ?? ''
  if (/^[a-z0-9-]+$/i.test(legacyStore)) return <Navigate to={`/shopper/${legacyStore}`} replace />
  return <LoginPage />
}

