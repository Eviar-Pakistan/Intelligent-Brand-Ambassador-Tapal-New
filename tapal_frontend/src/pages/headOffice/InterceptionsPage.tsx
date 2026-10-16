import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Card, PageHeader, SearchInput, Select, TableScroll, Tabs } from '../../components/ui'
import { useCreatedStores } from '../../lib/storeRegistry'
import { currentPortal, portalGet } from '../../lib/serverApi'
import { countsTowardConversion, interceptionStatusLabel } from '../../lib/userInterceptions'
import type { UserInterception } from '../../lib/userInterceptions'

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rangeFor(preset: string): [string, string] {
  const today = new Date()
  const from = new Date(today)
  if (preset === 'Last 7 days') from.setDate(from.getDate() - 6)
  if (preset === 'This month') from.setDate(1)
  return [isoDay(from), isoDay(today)]
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  })
}

async function download(rows: UserInterception[], from: string, to: string) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['When', 'BA', 'Store', 'City', 'Subtown', 'Shopper', 'Contact', 'City / Area', 'Previous brand', 'Previous SKU', 'Purchased SKU', 'Type', 'Switched to Tapal', 'Feedback'],
    ...rows.map((r) => [
      when(r.createdAt),
      r.baName,
      r.storeName,
      r.storeCity || '',
      r.storeSubtown || '',
      r.name,
      r.contact,
      r.cityArea,
      r.previousBrand,
      r.previousSku,
      r.currentSku,
      interceptionStatusLabel(r.status),
      countsTowardConversion(r) ? 'Yes' : 'No',
      r.feedback,
    ]),
  ])
  sheet['!cols'] = [18, 22, 26, 16, 16, 20, 14, 16, 16, 18, 18, 14, 12, 40].map((wch) => ({ wch }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Interceptions')
  XLSX.writeFile(book, `BA_Interceptions_${from}_to_${to}.xlsx`)
}

/** Shoppers the BAs spoke with (the BA's User interception form). Head Office: all / their city; supervisor: their stores. */
export function InterceptionsPage() {
  const [preset, setPreset] = useState('Today')
  const [[from, to], setRange] = useState<[string, string]>(() => rangeFor('Today'))
  const [rows, setRows] = useState<UserInterception[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [switchedOnly, setSwitchedOnly] = useState(false)
  const [city, setCity] = useState('')
  const [subtown, setSubtown] = useState('')
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [switchedCount, setSwitchedCount] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const stores = useCreatedStores()
  const pageSize = 50

  useEffect(() => {
    void import('../../lib/djangoSync').then(({ syncDjango }) => syncDjango())
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(id)
  }, [query])

  const listQuery = useMemo(() => {
    const params = new URLSearchParams({
      date_from: from,
      date_to: to,
      page: String(page),
      page_size: String(pageSize),
    })
    if (city) params.set('city', city)
    if (subtown) params.set('subtown', subtown)
    if (search) params.set('q', search)
    if (switchedOnly) params.set('switched', '1')
    return params.toString()
  }, [from, to, page, city, subtown, search, switchedOnly])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    const portal = currentPortal() === 'supervisor' ? 'supervisor' : 'office'
    void portalGet<{ results: UserInterception[]; count?: number; switched?: number }>(
      `/api/interceptions/?${listQuery}`,
      portal,
    ).then((data) => {
      if (cancelled) return
      if (!data) setError('Interceptions could not be loaded. Check that you are signed in and the server is running.')
      else {
        setError(null)
        setRows(data.results)
        setCount(data.count ?? data.results.length)
        if (typeof data.switched === 'number') setSwitchedCount(data.switched)
      }
    })
    return () => {
      cancelled = true
    }
  }, [listQuery])

  useEffect(() => {
    if (switchedOnly) return
    let cancelled = false
    setSwitchedCount(null)
    const params = new URLSearchParams({
      date_from: from,
      date_to: to,
      page: '1',
      summary: '1',
    })
    if (city) params.set('city', city)
    if (subtown) params.set('subtown', subtown)
    if (search) params.set('q', search)
    const portal = currentPortal() === 'supervisor' ? 'supervisor' : 'office'
    void portalGet<{ count?: number; switched?: number }>(`/api/interceptions/?${params.toString()}`, portal).then((data) => {
      if (cancelled || !data || typeof data.switched !== 'number') return
      setSwitchedCount(data.switched)
    })
    return () => {
      cancelled = true
    }
  }, [from, to, city, subtown, search, switchedOnly])

  const placeOf = useMemo(() => {
    const byId = new Map(stores.map((store) => [store.id, store]))
    return (row: UserInterception) => {
      const store = row.storeId != null ? byId.get(row.storeId) : undefined
      return {
        city: (row.storeCity || store?.city || '').trim(),
        subtown: (row.storeSubtown || store?.subtown || '').trim(),
      }
    }
  }, [stores])

  const cities = useMemo(() => {
    const names = new Set<string>()
    for (const store of stores) if (store.city.trim()) names.add(store.city.trim())
    for (const row of rows ?? []) {
      const cityName = placeOf(row).city
      if (cityName) names.add(cityName)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [stores, rows, placeOf])

  const subtowns = useMemo(() => {
    const names = new Set<string>()
    const cityKey = city.trim().toLowerCase()
    for (const store of stores) {
      if (!store.subtown.trim()) continue
      if (cityKey && store.city.trim().toLowerCase() !== cityKey) continue
      names.add(store.subtown.trim())
    }
    for (const row of rows ?? []) {
      const place = placeOf(row)
      if (!place.subtown) continue
      if (cityKey && place.city.toLowerCase() !== cityKey) continue
      names.add(place.subtown)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [stores, rows, city, placeOf])

  const shown = rows ?? []
  const pageCount = Math.max(1, Math.ceil(count / pageSize))
  const rangeStart = count === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, count)

  async function downloadAll() {
    const portal = currentPortal() === 'supervisor' ? 'supervisor' : 'office'
    const collected: UserInterception[] = []
    let next = 1
    let total = Infinity
    setDownloading(true)
    try {
      while (collected.length < total) {
        const params = new URLSearchParams({
          date_from: from,
          date_to: to,
          page: String(next),
          page_size: '200',
        })
        if (city) params.set('city', city)
        if (subtown) params.set('subtown', subtown)
        if (search) params.set('q', search)
        if (switchedOnly) params.set('switched', '1')
        const data = await portalGet<{ results: UserInterception[]; count?: number }>(
          `/api/interceptions/?${params.toString()}`,
          portal,
        )
        if (!data) throw new Error('Interceptions could not be downloaded.')
        total = data.count ?? data.results.length
        collected.push(...data.results)
        if (!data.results.length) break
        next += 1
      }
      await download(collected, from, to)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="User interceptions"
        description="Shoppers the BAs spoke with in store — who they are, what they used, what they bought"
        actions={
          <Button variant="secondary" disabled={count === 0 || downloading} onClick={() => void downloadAll()}>
            <Download size={15} /> Download
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Tabs
            tabs={['Today', 'Last 7 days', 'This month']}
            value={preset}
            onChange={(next) => {
              setPreset(next)
              setPage(1)
              setRange(rangeFor(next))
            }}
          />
          {(['From', 'To'] as const).map((label, i) => (
            <label key={label} className="text-xs text-slate-500">
              {label}
              <input
                type="date"
                value={i === 0 ? from : to}
                max={isoDay(new Date())}
                onChange={(e) => {
                  setPreset('')
                  setPage(1)
                  setRange(i === 0 ? [e.target.value, to] : [from, e.target.value])
                }}
                className="ml-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
              />
            </label>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card>
          <div className="text-xs text-slate-500">Shoppers intercepted</div>
          <div className="text-2xl font-bold">{rows ? count.toLocaleString() : '—'}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Switched to Tapal</div>
          <div className="text-2xl font-bold text-emerald-600">{switchedCount == null ? '—' : switchedCount.toLocaleString()}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Conversion</div>
          <div className="text-2xl font-bold">
            {switchedCount == null || !count ? '—' : `${Math.round((switchedCount / count) * 100)}%`}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          placeholder="Search BA, store, shopper, brand..."
          value={query}
          onChange={(e) => {
            setPage(1)
            setQuery(e.target.value)
          }}
        />
        <Select
          value={city}
          onChange={(e) => {
            setPage(1)
            setCity(e.target.value)
            setSubtown('')
          }}
          aria-label="City"
        >
          <option value="">All cities</option>
          {cities.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          value={subtown}
          onChange={(e) => {
            setPage(1)
            setSubtown(e.target.value)
          }}
          aria-label="Subtown"
        >
          <option value="">All subtowns</option>
          {subtowns.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={switchedOnly}
            onChange={(e) => {
              setPage(1)
              setSwitchedOnly(e.target.checked)
            }}
          />
          Switched to Tapal only
        </label>
      </div>

      <Card padding={false}>
        {error ? (
          <p className="px-4 py-6 text-sm text-rose-700">{error}</p>
        ) : (
          <TableScroll minWidth={960}>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">BA</th>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Shopper</th>
                  <th className="px-4 py-3">Previous</th>
                  <th className="px-4 py-3">Purchased</th>
                  <th className="px-4 py-3">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{when(r.createdAt)}</td>
                    <td className="px-4 py-3 font-medium">{r.baName}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{r.storeName || '—'}</div>
                      <div className="text-xs text-slate-400">{[placeOf(r).city, placeOf(r).subtown].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-slate-400">
                        {[r.contact, r.cityArea].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{r.previousBrand || '—'}</div>
                      <div className="text-xs text-slate-400">{r.previousSku}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{r.currentSku || '—'}</div>
                      <div className="text-xs text-slate-400">{interceptionStatusLabel(r.status)}</div>
                      {countsTowardConversion(r) && (
                        <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Switched
                        </span>
                      )}
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 text-slate-600">{r.feedback || '—'}</td>
                  </tr>
                ))}
                {rows && shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      No interceptions in this period.
                    </td>
                  </tr>
                )}
                {!rows && !error && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        )}
        {rows && count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {count.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
