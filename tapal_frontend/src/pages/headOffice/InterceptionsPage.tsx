import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Card, PageHeader, SearchInput, TableScroll, Tabs } from '../../components/ui'
import { currentPortal, portalGet } from '../../lib/serverApi'
import { interceptionStatusLabel, switchedToTapal } from '../../lib/userInterceptions'
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
    ['When', 'BA', 'Store', 'Shopper', 'Contact', 'City / Area', 'Previous brand', 'Previous SKU', 'Purchased SKU', 'Type', 'Switched to Tapal', 'Feedback'],
    ...rows.map((r) => [
      when(r.createdAt),
      r.baName,
      r.storeName,
      r.name,
      r.contact,
      r.cityArea,
      r.previousBrand,
      r.previousSku,
      r.currentSku,
      interceptionStatusLabel(r.status),
      switchedToTapal(r.previousBrand) ? 'Yes' : 'No',
      r.feedback,
    ]),
  ])
  sheet['!cols'] = [18, 22, 26, 20, 14, 16, 16, 18, 18, 14, 12, 40].map((wch) => ({ wch }))
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
  const [switchedOnly, setSwitchedOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    void portalGet<{ results: UserInterception[] }>(
      `/api/interceptions/?date_from=${from}&date_to=${to}`,
      currentPortal() === 'supervisor' ? 'supervisor' : 'office',
    ).then((data) => {
      if (cancelled) return
      if (!data) setError('Interceptions could not be loaded. Check that you are signed in and the server is running.')
      else {
        setError(null)
        setRows(data.results)
      }
    })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (r) =>
        (!switchedOnly || switchedToTapal(r.previousBrand)) &&
        (!q ||
          [r.baName, r.storeName, r.name, r.contact, r.previousBrand, r.currentSku, r.cityArea].some((v) =>
            (v ?? '').toLowerCase().includes(q),
          )),
    )
  }, [rows, query, switchedOnly])

  const switched = shown.filter((r) => switchedToTapal(r.previousBrand)).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="User interceptions"
        description="Shoppers the BAs spoke with in store — who they are, what they used, what they bought"
        actions={
          <Button variant="secondary" disabled={shown.length === 0} onClick={() => void download(shown, from, to)}>
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
          <div className="text-2xl font-bold">{rows ? shown.length : '—'}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Switched to Tapal</div>
          <div className="text-2xl font-bold text-emerald-600">{rows ? switched : '—'}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Conversion</div>
          <div className="text-2xl font-bold">{rows && shown.length ? `${Math.round((switched / shown.length) * 100)}%` : '—'}</div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search BA, store, shopper, brand..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={switchedOnly} onChange={(e) => setSwitchedOnly(e.target.checked)} />
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
                    <td className="px-4 py-3 text-slate-600">{r.storeName || '—'}</td>
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
                      {switchedToTapal(r.previousBrand) && (
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
      </Card>
    </div>
  )
}
