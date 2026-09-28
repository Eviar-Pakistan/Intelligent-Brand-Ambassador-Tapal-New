import { useMemo, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button, Modal, Tabs } from '../../components/ui'
import { Time12Select } from '../../components/Time12Select'
import { shiftLabelFromTimes } from '../../context/ScheduleContext'
import { isDemoBa, useBaAccounts } from '../../lib/baAccounts'
import { currentMonthKey, formatTargetMonth } from '../../lib/baTargets'
import {
  checkShiftRow,
  downloadShiftTemplate,
  parseShiftFile,
  saveShiftPlans,
  type ShiftParseResult,
  type ShiftSaveResult,
} from '../../lib/shiftUploads'
import { useCreatedStores } from '../../lib/storeRegistry'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500'

function ResultBox({ result }: { result: ShiftSaveResult }) {
  return (
    <div className="space-y-2">
      {result.rowsSaved > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved {result.created} monthly {result.created === 1 ? 'shift' : 'shifts'}
          {result.skippedExisting > 0 && ` · ${result.skippedExisting} already existed`}
          {result.conflicts > 0 && ` · ${result.conflicts} overlap another shift (marked Conflict)`}.
        </div>
      )}
      <ErrorList
        errors={result.errors}
        title={result.rowsSaved > 0 ? `${result.errors.length} ${result.errors.length === 1 ? 'row was' : 'rows were'} skipped:` : 'Nothing was saved:'}
      />
    </div>
  )
}

function ErrorList({ errors, title }: { errors: string[]; title: string }) {
  if (errors.length === 0) return null
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
      <div className="font-semibold">{title}</div>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
        {errors.slice(0, 8).map((err) => (
          <li key={err}>{err}</li>
        ))}
      </ul>
      {errors.length > 8 && <div className="mt-1 font-medium">…and {errors.length - 8} more</div>}
    </div>
  )
}

/** Create monthly shifts for one BA, or many from an Excel file. Saved in Django. */
export function ShiftPlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState('Individual')
  const accounts = useBaAccounts()
  const createdStores = useCreatedStores()
  const baOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.baCode && !isDemoBa(a.id))
        .map((a) => ({ code: a.baCode, name: a.name, status: a.status }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  )
  const storeOptions = useMemo(
    () =>
      createdStores
        .filter((s) => s.storeCode)
        .map((s) => ({ code: s.storeCode, name: `${s.name} · ${s.city}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [createdStores],
  )

  const [form, setForm] = useState({ baCode: '', storeCode: '', startTime: '10:00', endTime: '18:00', month: currentMonthKey() })
  const [saving, setSaving] = useState(false)
  const [single, setSingle] = useState<ShiftSaveResult | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ShiftParseResult | null>(null)
  const [bulk, setBulk] = useState<ShiftSaveResult | null>(null)

  const baCode = form.baCode || baOptions[0]?.code || ''
  const storeCode = form.storeCode || storeOptions[0]?.code || ''
  const formProblems = checkShiftRow({ ...form, baCode, storeCode })

  function update(patch: Partial<typeof form>) {
    setSingle(null)
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function close() {
    setSingle(null)
    setParsed(null)
    setBulk(null)
    setFileName('')
    onClose()
  }

  async function saveSingle() {
    if (formProblems.length > 0) return
    setSaving(true)
    setSingle(await saveShiftPlans([{ ...form, baCode, storeCode }]))
    setSaving(false)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setBulk(null)
    setFileName(file.name)
    setParsed(await parseShiftFile(file))
  }

  async function saveBulk() {
    if (!parsed?.rows.length) return
    setSaving(true)
    const result = await saveShiftPlans(parsed.rows)
    // Rows the file check skipped are listed with the server's own errors.
    setBulk({ ...result, errors: [...parsed.errors, ...result.errors] })
    setParsed(null)
    setSaving(false)
  }

  return (
    <Modal open={open} onClose={close} title="Create shifts">
      <div className="space-y-4 text-sm">
        <Tabs tabs={['Individual', 'Bulk (Excel)']} value={tab} onChange={setTab} />

        {tab === 'Individual' ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block font-medium text-slate-700">Ambassador (BA code)</span>
              <select value={baCode} onChange={(e) => update({ baCode: e.target.value })} className={inputClass}>
                {baOptions.length === 0 && <option value="">No ambassadors with a BA code</option>}
                {baOptions.map((ba) => (
                  <option key={ba.code} value={ba.code}>
                    {ba.code} · {ba.name}
                    {ba.status !== 'Certified' ? ` (${ba.status})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-medium text-slate-700">Store (store code)</span>
              <select value={storeCode} onChange={(e) => update({ storeCode: e.target.value })} className={inputClass}>
                {storeOptions.length === 0 && <option value="">No stores with a store code</option>}
                {storeOptions.map((store) => (
                  <option key={store.code} value={store.code}>
                    {store.code} · {store.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block font-medium text-slate-700">Start time</span>
                <Time12Select value={form.startTime} onChange={(startTime) => update({ startTime })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block font-medium text-slate-700">End time</span>
                <Time12Select value={form.endTime} onChange={(endTime) => update({ endTime })} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block font-medium text-slate-700">Month</span>
              <input type="month" value={form.month} onChange={(e) => update({ month: e.target.value })} className={inputClass} />
            </label>
            <p className="text-xs text-slate-500">
              {shiftLabelFromTimes(form.startTime, form.endTime)} (Karachi time) for{' '}
              {form.month ? formatTargetMonth(form.month) : 'the month'}.
            </p>
            {single ? (
              <ResultBox result={single} />
            ) : (
              baCode && storeCode && formProblems.length > 0 && <ErrorList errors={formProblems} title="Fix before saving:" />
            )}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
              <Button onClick={() => void saveSingle()} disabled={saving || formProblems.length > 0}>
                {saving ? 'Saving…' : 'Save shifts'}
              </Button>
              <Button variant="secondary" onClick={close}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="font-semibold text-slate-900">1. Download the template</div>
              <p className="text-xs text-slate-500">
                Columns: BA Code, Store Code, Start Time, End Time, Month. Times are 12-hour Karachi time, for example
                10:00 AM and 6:00 PM. Each row is one monthly shift. The Instructions sheet lists
                every BA and store code.
              </p>
              <Button variant="secondary" onClick={() => void downloadShiftTemplate(baOptions, storeOptions)}>
                <Download size={14} /> Download shift template
              </Button>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="font-semibold text-slate-900">2. Upload the filled template</div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={(event) => {
                  void onFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <div className="flex items-center gap-3">
                <Button variant="secondary" disabled={saving} onClick={() => inputRef.current?.click()}>
                  <Upload size={14} /> {parsed || bulk ? 'Choose another file' : 'Upload Excel file'}
                </Button>
                {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
              </div>
            </div>

            {bulk && <ResultBox result={bulk} />}

            {parsed && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                {parsed.rows.length > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                    {parsed.rows.length} {parsed.rows.length === 1 ? 'row is' : 'rows are'} ready to save.
                  </div>
                )}
                <ErrorList
                  errors={parsed.errors}
                  title={
                    parsed.rows.length > 0
                      ? `${parsed.errors.length} ${parsed.errors.length === 1 ? 'row' : 'rows'} will be skipped:`
                      : 'Nothing can be saved yet:'
                  }
                />
                {parsed.rows.length > 0 && (
                  <Button className="w-full" disabled={saving} onClick={() => void saveBulk()}>
                    {saving ? 'Saving…' : `Save ${parsed.rows.length} ${parsed.rows.length === 1 ? 'row' : 'rows'}`}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
