import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Card, PageHeader, Tabs, cn } from '../../components/ui'
import { labeledStock, STOCK_OPTIONS } from '../../lib/baReport'
import { portalGet, resultsOf } from '../../lib/serverApi'

type StockStatus = (typeof STOCK_OPTIONS)[number]

/** One store's stock, from the latest stock report a BA filed there. */
type StoreStock = {
  storeId: number
  storeName: string
  city: string
  baName: string
  submittedAt: string
  stock: Record<string, string>
}

const STATUS_STYLE: Record<StockStatus, string> = {
  'In Stock': 'bg-emerald-100 text-emerald-600',
  'Near Out of Stock': 'bg-amber-100 text-amber-600',
  'Out of Stock': 'bg-rose-100 text-rose-600',
}
const LEGEND: StockStatus[] = ['In Stock', 'Near Out of Stock', 'Out of Stock']
const ALL_CITIES = 'All cities'
const REFRESH_MS = 60_000

function StatusTick({ status }: { status: StockStatus }) {
  return (
    <span
      title={status}
      aria-label={status}
      className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full', STATUS_STYLE[status])}
    >
      <Check size={14} strokeWidth={3} />
    </span>
  )
}

/** Stores down the side, SKUs across the top: green / yellow / red tick per SKU. */
export function StockBoardPage() {
  const [stores, setStores] = useState<StoreStock[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [city, setCity] = useState(ALL_CITIES)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      portalGet<{ results: StoreStock[] }>('/api/stock-board/').then((payload) => {
        if (cancelled) return
        const rows = resultsOf(payload)
        if (rows) setStores(rows)
        setFailed(!rows)
      })
    void load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const cities = useMemo(() => [...new Set((stores ?? []).map((s) => s.city).filter(Boolean))].sort(), [stores])
  const activeCity = cities.includes(city) ? city : ALL_CITIES

  const { rows, skus } = useMemo(() => {
    const shown = (stores ?? []).filter((s) => activeCity === ALL_CITIES || s.city === activeCity)
    const skus: string[] = []
    const rows = shown.map((store) => {
      const bySku = new Map<string, StockStatus>()
      for (const line of labeledStock(store.stock)) {
        if (!STOCK_OPTIONS.includes(line.value as StockStatus)) continue
        bySku.set(line.item, line.value as StockStatus)
        if (!skus.includes(line.item)) skus.push(line.item)
      }
      return { store, bySku }
    })
    return { rows, skus }
  }, [stores, activeCity])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock"
        description="Stock status per SKU in each store, from the latest stock report its BA submitted"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {cities.length > 1 ? (
          <Tabs tabs={[ALL_CITIES, ...cities]} value={activeCity} onChange={setCity} />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          {LEGEND.map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <StatusTick status={status} /> {status}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-6 text-center text-slate-300">—</span> Not reported
          </span>
        </div>
      </div>

      <Card padding={false}>
        {stores === null ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            {failed ? 'Stock could not be loaded. Check that the server is running.' : 'Loading stock…'}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">No stock reports yet.</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-20 min-w-[13rem] border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                    Store
                  </th>
                  {skus.map((sku) => (
                    <th
                      key={sku}
                      className="sticky top-0 z-10 w-24 min-w-[6rem] border-b border-slate-200 bg-slate-50 px-2 py-3 text-center align-bottom text-[11px] leading-tight font-semibold text-slate-600"
                    >
                      {sku}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ store, bySku }) => (
                  <tr key={store.storeId}>
                    <th className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5 text-left font-normal">
                      <div className="font-semibold text-slate-900">{store.storeName}</div>
                      <div className="text-[11px] text-slate-400">
                        {[store.city, store.baName].filter(Boolean).join(' · ')}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {new Date(store.submittedAt).toLocaleString('en-PK', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </th>
                    {skus.map((sku) => {
                      const status = bySku.get(sku)
                      return (
                        <td key={sku} className="border-b border-slate-100 px-2 py-2.5 text-center">
                          {status ? <StatusTick status={status} /> : <span className="text-slate-300">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
