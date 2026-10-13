import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemoBa, useBaAccounts } from '../../lib/baAccounts'
import {
  createDailyReportAsMis,
  DEFAULT_OTHER_BRANDS,
  emptyReportValues,
  fixedSalesSections,
  isUnitSalesKey,
  isWholeUnits,
  loadReportSectionsForBa,
  STOCK_OPTIONS,
  type OtherBrandRow,
  type ReportSections,
  type StoredDailyReport,
} from '../../lib/baReport'
import { serverAmbassadorId } from '../../context/ScheduleContext'
import { portalGet } from '../../lib/serverApi'
import { Button, Modal } from '../../components/ui'
import { useAttendance, type AttendanceRow } from './BaAttendancePage'

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthOf(isoDate: string) {
  return isoDate.slice(0, 7)
}

function dateLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-PK', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (report: StoredDailyReport) => void
}

export function MisCreateDailyReportModal({ open, onClose, onCreated }: Props) {
  const accounts = useBaAccounts().filter((a) => !isDemoBa(a.id) && a.isActive !== false)
  const [baAccountId, setBaAccountId] = useState('')
  const [shiftId, setShiftId] = useState<string>('')
  const [sections, setSections] = useState<ReportSections | null>(null)
  const [stock, setStock] = useState<Record<string, string>>({})
  const [sales, setSales] = useState<Record<string, string>>({})
  const [brands, setBrands] = useState<OtherBrandRow[]>(DEFAULT_OTHER_BRANDS)
  const [loadingSkus, setLoadingSkus] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const serverId = baAccountId ? serverAmbassadorId(baAccountId) : null
  const today = useMemo(() => isoDay(new Date()), [])
  const monthStart = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [])

  const { data: attendanceData, loading: shiftsLoading, error: shiftsError } = useAttendance(
    monthStart,
    today,
    open ? serverId : null,
  )

  const shifts = attendanceData?.results ?? []
  const selectedShift = shifts.find((row) => row.id === shiftId) ?? null
  const selectedBa = accounts.find((a) => a.id === baAccountId) ?? null

  useEffect(() => {
    if (!open) {
      setBaAccountId('')
      setShiftId('')
      setSections(null)
      setStock({})
      setSales({})
      setBrands(DEFAULT_OTHER_BRANDS)
      setError(null)
      setBusy(false)
    }
  }, [open])

  useEffect(() => {
    setShiftId('')
    setSections(null)
    setStock({})
    setSales({})
    setBrands(DEFAULT_OTHER_BRANDS)
    setError(null)
  }, [baAccountId])

  useEffect(() => {
    if (!selectedShift) {
      setSections(null)
      setStock({})
      setSales({})
      setBrands(DEFAULT_OTHER_BRANDS)
      return
    }
    const ownerId = selectedShift.reportOwnerId ?? selectedShift.baId
    let cancelled = false
    setLoadingSkus(true)
    setError(null)
    void (async () => {
      try {
        const nextSections = await loadReportSectionsForBa(ownerId, monthOf(selectedShift.date))
        if (cancelled) return
        setSections(nextSections)
        const empty = emptyReportValues(nextSections)
        setStock(empty.stock)
        setSales(empty.sales)

        const fields = await portalGet<{
          results: Array<{ key: string; label: string; fieldType: 'text' | 'number' }>
        }>(`/api/competitor-fields/?storeId=${selectedShift.storeId}`, 'office')
        if (cancelled) return
        if (fields?.results?.length) {
          setBrands(
            fields.results.map((field) => ({
              id: field.key,
              name: field.label,
              price: '',
              fieldType: field.fieldType,
            })),
          )
        } else {
          setBrands(DEFAULT_OTHER_BRANDS.map((row) => ({ ...row, price: '' })))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load SKUs for this BA.')
        }
      } finally {
        if (!cancelled) setLoadingSkus(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedShift?.id])

  async function submit() {
    if (!selectedShift) return
    setError(null)
    for (const [key, value] of Object.entries(sales)) {
      if (isUnitSalesKey(key) && value.trim() && !isWholeUnits(value)) {
        setError('SKU sales must be whole numbers (units).')
        return
      }
    }
    const hasContent =
      Object.values(stock).some((v) => v.trim()) ||
      Object.values(sales).some((v) => v.trim()) ||
      brands.some((b) => b.price.trim())
    if (!hasContent) {
      setError('Fill at least one stock, sales, or competitor field.')
      return
    }
    setBusy(true)
    try {
      const saved = await createDailyReportAsMis({
        shiftId: Number(selectedShift.id),
        stock,
        sales,
        otherBrands: brands,
      })
      onCreated(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title="Create Daily Report">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Choose a BA and shift day, then fill stock, sales, and competitor data. The report is saved for that
          shift date.
        </p>

        <label className="block space-y-1">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Brand Ambassador</span>
          <select
            value={baAccountId}
            onChange={(e) => setBaAccountId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500"
          >
            <option value="">Select BA…</option>
            {accounts
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.baCode ? ` · ${account.baCode}` : ''}
                  {account.city ? ` · ${account.city}` : ''}
                </option>
              ))}
          </select>
        </label>

        {baAccountId && serverId == null && (
          <p className="text-sm text-rose-600">This BA is not linked to the server.</p>
        )}

        {baAccountId && serverId != null && (
          <div className="space-y-2">
            <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Shifts this month</div>
            {shiftsLoading && <p className="text-sm text-slate-500">Loading shifts…</p>}
            {shiftsError && <p className="text-sm text-rose-600">{shiftsError}</p>}
            {!shiftsLoading && !shiftsError && shifts.length === 0 && (
              <p className="text-sm text-slate-500">No shifts found for this BA this month.</p>
            )}
            {shifts.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1">
                {shifts.map((row) => (
                  <ShiftOption
                    key={row.id}
                    row={row}
                    selected={shiftId === row.id}
                    onSelect={() => setShiftId(row.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {selectedShift && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {selectedBa?.name || selectedShift.baName} · {dateLabel(selectedShift.date)}
                </div>
                <p className="text-xs text-slate-500">
                  {[selectedShift.storeName, selectedShift.city, selectedShift.shift, selectedShift.attendanceType]
                    .filter(Boolean)
                    .join(' · ')}
                  {sections
                    ? sections.fromTarget
                      ? ' · SKUs from month target'
                      : ' · SKUs from city list'
                    : ''}
                </p>
              </div>
              {selectedShift.reportSubmittedAt ? (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  Report already submitted — saving will update it
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  No report yet
                </span>
              )}
            </div>

            {loadingSkus || !sections ? (
              <p className="text-sm text-slate-500">Loading form fields…</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormColumn title="Stock Report">
                  {sections.stock.flatMap((section) =>
                    section.fields.map((field) => (
                      <FieldRow key={field.key} label={field.label}>
                        <select
                          value={stock[field.key] ?? ''}
                          onChange={(e) => setStock((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          className="max-w-[9.5rem] rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-900 outline-none focus:border-brand-500"
                        >
                          <option value="">—</option>
                          {STOCK_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </FieldRow>
                    )),
                  )}
                </FormColumn>

                <FormColumn title="Daily Sales">
                  {[...fixedSalesSections, ...sections.skuSales].flatMap((section) =>
                    section.fields.map((field) => (
                      <FieldRow key={field.key} label={field.label}>
                        <input
                          type="text"
                          inputMode={isUnitSalesKey(field.key) ? 'numeric' : 'decimal'}
                          value={sales[field.key] ?? ''}
                          onChange={(e) => setSales((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-semibold text-slate-900 outline-none focus:border-brand-500"
                        />
                      </FieldRow>
                    )),
                  )}
                </FormColumn>

                <FormColumn title="Competitor data">
                  {brands.map((brand, index) => (
                    <FieldRow key={brand.id || `${brand.name}-${index}`} label={brand.name || '—'}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={brand.price}
                        onChange={(e) =>
                          setBrands((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, price: e.target.value } : row)),
                          )
                        }
                        className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-semibold text-slate-900 outline-none focus:border-brand-500"
                      />
                    </FieldRow>
                  ))}
                </FormColumn>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={busy || !selectedShift || loadingSkus || !sections}
          >
            {busy ? 'Creating…' : selectedShift?.reportSubmittedAt ? 'Update report' : 'Create report'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ShiftOption({
  row,
  selected,
  onSelect,
}: {
  row: AttendanceRow
  selected: boolean
  onSelect: () => void
}) {
  const submitted = !!row.reportSubmittedAt
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
          selected ? 'bg-brand-50 ring-1 ring-brand-500' : 'hover:bg-slate-50'
        }`}
      >
        <span className="min-w-0">
          <span className="font-semibold text-slate-900">{dateLabel(row.date)}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {[row.storeName, row.shift, row.attendanceType === 'training' ? 'Training' : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            submitted ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {submitted ? 'Submitted' : 'Not submitted'}
        </span>
      </button>
    </li>
  )
}

function FormColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">{title}</div>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs">{children}</ul>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="min-w-0 flex-1 text-slate-600">{label}</span>
      {children}
    </li>
  )
}
