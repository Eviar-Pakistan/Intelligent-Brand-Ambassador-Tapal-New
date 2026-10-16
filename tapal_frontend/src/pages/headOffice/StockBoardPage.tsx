import { useEffect, useMemo, useState } from 'react'
import { Check, Download } from 'lucide-react'
import { Button, Card, ListPager, PageHeader, SearchInput, Tabs, cn, usePagedList } from '../../components/ui'
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

type BoardRow = { store: StoreStock; bySku: Map<string, StockStatus> }

function submittedLabel(iso: string) {
  return new Date(iso).toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Excel of the board currently on screen (city filter included). */
async function downloadStockBoard(rows: BoardRow[], skus: string[], city: string) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Store', 'City', 'BA', 'Submitted', ...skus],
    ...rows.map(({ store, bySku }) => [
      store.storeName,
      store.city,
      store.baName,
      submittedLabel(store.submittedAt),
      ...skus.map((sku) => bySku.get(sku) ?? ''),
    ]),
  ])
  sheet['!cols'] = [28, 16, 22, 22, ...skus.map(() => 18)].map((wch) => ({ wch }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Stock')
  const day = new Date().toISOString().slice(0, 10)
  const cityPart = city === ALL_CITIES ? 'All' : city.replace(/\s+/g, '_')
  XLSX.writeFile(book, `Tapal_Stock_${cityPart}_${day}.xlsx`)
}

/** Stores down the side, SKUs across the top: green / yellow / red tick per SKU. */
export function StockBoardPage() {
  const [stores, setStores] = useState<StoreStock[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [city, setCity] = useState(ALL_CITIES)
  const [storeQuery, setStoreQuery] = useState('')
  const [skuQuery, setSkuQuery] = useState('')

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
    const storeText = storeQuery.trim().toLowerCase()
    const skuText = skuQuery.trim().toLowerCase()
    const shown = (stores ?? []).filter((s) => {
      if (activeCity !== ALL_CITIES && s.city !== activeCity) return false
      if (!storeText) return true
      return [s.storeName, s.city, s.baName].some((value) => (value ?? '').toLowerCase().includes(storeText))
    })
    const skus: string[] = []
    const rows = shown.map((store) => {
      const bySku = new Map<string, StockStatus>()
      for (const line of labeledStock(store.stock)) {
        if (!STOCK_OPTIONS.includes(line.value as StockStatus)) continue
        if (skuText && !line.item.toLowerCase().includes(skuText)) continue
        bySku.set(line.item, line.value as StockStatus)
        if (!skus.includes(line.item)) skus.push(line.item)
      }
      return { store, bySku }
    }).filter((row) => !skuText || row.bySku.size > 0)
    return { rows, skus }
  }, [stores, activeCity, storeQuery, skuQuery])
  const stockPage = usePagedList(rows, `${activeCity}|${storeQuery}|${skuQuery}`)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock"
        description="Stock status per SKU in each store, from the latest stock report its BA submitted"
        actions={
          <Button
            variant="secondary"
            disabled={rows.length === 0 || skus.length === 0}
            onClick={() => void downloadStockBoard(rows, skus, activeCity)}
          >
            <Download size={15} /> Download
          </Button>
        }
      />

      <div className="space-y-3">
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-52">
            <SearchInput
              value={storeQuery}
              onChange={(event) => setStoreQuery(event.target.value)}
              placeholder="Filter stores"
              aria-label="Filter stores"
            />
          </div>
          <div className="w-full sm:w-52">
            <SearchInput
              value={skuQuery}
              onChange={(event) => setSkuQuery(event.target.value)}
              placeholder="Filter SKUs"
              aria-label="Filter SKUs"
            />
          </div>
        </div>
      </div>

      <Card padding={false}>
        {stores === null ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            {failed ? 'Stock could not be loaded. Check that the server is running.' : 'Loading stock…'}
          </p>
        ) : rows.length === 0 || skus.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            {storeQuery.trim() || skuQuery.trim() ? 'No stock matches these filters.' : 'No stock reports yet.'}
          </p>
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
                {stockPage.rows.map(({ store, bySku }) => (
                  <tr key={store.storeId}>
                    <th className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5 text-left font-normal">
                      <div className="font-semibold text-slate-900">{store.storeName}</div>
                      <div className="text-[11px] text-slate-400">
                        {[store.city, store.baName].filter(Boolean).join(' · ')}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {submittedLabel(store.submittedAt)}
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
        <ListPager
          page={stockPage.page}
          pageCount={stockPage.pageCount}
          from={stockPage.from}
          to={stockPage.to}
          total={stockPage.total}
          onPage={stockPage.setPage}
        />
      </Card>
    </div>
  )
}
