import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Card } from './ui'
import { qrDataUrl, shopperLink } from '../lib/storeRegistry'
import type { Store } from '../data/mock'

/** The QR shoppers scan to open one store's journey, with its link. */
export function StoreQrCard({ store }: { store: Pick<Store, 'id' | 'qrCode' | 'name' | 'city'> }) {
  const link = shopperLink(store)
  const [png, setPng] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    qrDataUrl(link, 512)
      .then((url) => !cancelled && setPng(url))
      .catch(() => !cancelled && setPng(null))
    return () => {
      cancelled = true
    }
  }, [link])

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-44 w-44 shrink-0 items-center justify-center rounded-2xl border border-slate-100 bg-white p-2">
          {png ? (
            <img src={png} alt={`QR code for ${store.name}`} className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-slate-400">Generating…</span>
          )}
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-lg font-bold text-slate-900">Shopper QR</h3>
          <p className="mt-1 text-sm text-slate-500">Scan to open the shopper journey for this store.</p>
          <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 font-mono text-xs break-all text-slate-700">
            {link}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-semibold">
            <a href={link} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
              Open link →
            </a>
            {png && (
              <a
                href={png}
                download={`${store.name.replace(/[^a-z0-9]+/gi, '-')}-shopper-qr.png`}
                className="inline-flex items-center gap-1.5 text-slate-600 hover:text-brand-600"
              >
                <Download size={14} /> Download QR
              </a>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
