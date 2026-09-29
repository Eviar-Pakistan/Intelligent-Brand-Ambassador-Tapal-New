import { useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { enterShopperStore, resolveShopperStore } from '../../lib/storeRegistry'

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
