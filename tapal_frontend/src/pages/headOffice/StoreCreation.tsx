import { useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Button, Card, Modal, PageHeader } from '../../components/ui'
import {
  CITIES,
  DEFAULT_PEAK_HOURS,
  FOOTFALLS,
  createStores,
  downloadStoreLinks,
  downloadStoreTemplate,
  parseStoreFile,
  roundCoord,
  storeExists,
  type CreatedStore,
  type Footfall,
  type StoreParseResult,
} from '../../lib/storeRegistry'

/** '/ho', '/manager' or '/admin' — store pages are shared between the three experiences. */
export function useRoleBase() {
  const { pathname } = useLocation()
  return `/${pathname.split('/')[1]}`
}

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500'

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className ?? ''}`}>
      <span className="mb-1.5 block font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  )
}

const emptyForm = {
  storeCode: '',
  name: '',
  city: CITIES[0],
  footfall: 'Medium' as Footfall,
  address: '',
  latitude: '',
  longitude: '',
  peakHours: DEFAULT_PEAK_HOURS,
  contactPerson: '',
  contactPhone: '',
}

export function CreateStorePage() {
  const navigate = useNavigate()
  const base = useRoleBase()
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const set = (key: keyof typeof emptyForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm({ ...form, [key]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const name = form.name.trim()
    if (!name) return setError('Store name is required.')
    if (storeExists(name, form.city)) return setError(`A store named "${name}" already exists in ${form.city}.`)

    const coord = (text: string, limit: number, label: string) => {
      if (!text.trim()) return null
      const n = Number(text)
      if (!Number.isFinite(n) || Math.abs(n) > limit) {
        setError(`${label} must be a number between -${limit} and ${limit}.`)
        return undefined
      }
      return roundCoord(n)
    }
    const latitude = coord(form.latitude, 90, 'Latitude')
    if (latitude === undefined) return
    const longitude = coord(form.longitude, 180, 'Longitude')
    if (longitude === undefined) return

    setBusy(true)
    setError(null)
    try {
      const [store] = await createStores([
        {
          storeCode: form.storeCode.trim(),
          name,
          city: form.city,
          footfall: form.footfall,
          address: form.address.trim(),
          latitude,
          longitude,
          peakHours: form.peakHours.trim() || DEFAULT_PEAK_HOURS,
          contactPerson: form.contactPerson.trim(),
          contactPhone: form.contactPhone.trim(),
        },
      ])
      navigate(`${base}/stores/${store.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The store could not be saved on the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Create Store"
        description="Add a new store outlet for field operations"
        actions={
          <Button variant="secondary" onClick={() => setBulkOpen(true)}>
            <FileSpreadsheet size={15} /> Bulk upload (Excel)
          </Button>
        }
      />
      <Card>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field label="Store code">
            <input className={fieldClass} value={form.storeCode} onChange={set('storeCode')} placeholder="Leave blank for a unique code" maxLength={32} />
          </Field>
          <Field label="Store name">
            <input
              className={fieldClass}
              value={form.name}
              onChange={set('name')}
              placeholder="e.g. Carrefour Johar Town"
              autoFocus
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              <select className={fieldClass} value={form.city} onChange={set('city')}>
                {CITIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Footfall">
              <select className={fieldClass} value={form.footfall} onChange={set('footfall')}>
                {FOOTFALLS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Address">
            <textarea
              className={fieldClass}
              rows={3}
              value={form.address}
              onChange={set('address')}
              placeholder="Street, area, landmark"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitude">
              <input className={fieldClass} value={form.latitude} onChange={set('latitude')} placeholder="e.g. 24.8607" inputMode="decimal" />
            </Field>
            <Field label="Longitude">
              <input className={fieldClass} value={form.longitude} onChange={set('longitude')} placeholder="e.g. 67.0011" inputMode="decimal" />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            Used for the Head Office live map. Example Karachi center: 24.8607, 67.0011
          </p>

          <Field label="Peak hours">
            <input className={fieldClass} value={form.peakHours} onChange={set('peakHours')} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person">
              <input className={fieldClass} value={form.contactPerson} onChange={set('contactPerson')} placeholder="Store contact name" />
            </Field>
            <Field label="Contact phone">
              <input className={fieldClass} value={form.contactPhone} onChange={set('contactPhone')} placeholder="03XX-XXXXXXX" inputMode="tel" />
            </Field>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Create Store'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate(`${base}/stores`)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>

      <BulkStoreModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  )
}

/** Download the template → fill it in → upload it → review → create many stores at once. */
export function BulkStoreModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const base = useRoleBase()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<StoreParseResult | null>(null)
  const [created, setCreated] = useState<CreatedStore[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function close() {
    setResult(null)
    setCreated(null)
    setFileName('')
    onClose()
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setFileName(file.name)
    setResult(await parseStoreFile(file))
    setBusy(false)
  }

  return (
    <Modal open={open} onClose={close} title="Create stores from Excel">
      <div className="space-y-4 text-sm">
        {created ? (
          <>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
              {created.length} {created.length === 1 ? 'store' : 'stores'} created. Each one has its own shopper QR
              code — open a store to see it.
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-3 text-slate-700">
              {created.map((s) => (
                <li key={s.id}>
                  <Link to={`${base}/stores/${s.id}`} onClick={close} className="font-medium hover:text-brand-600">
                    #{s.id} {s.name}
                  </Link>{' '}
                  <span className="text-xs text-slate-400">{s.city}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Link to={`${base}/stores`} onClick={close}>
                <Button className="w-full">View all stores</Button>
              </Link>
              <Button variant="secondary" onClick={() => void downloadStoreLinks(created.map((s) => ({ ...s, qrCode: s.slug })))}>
                <Download size={14} /> Download shopper links
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <div className="font-semibold text-slate-900">1. Download the template</div>
              <p className="text-xs text-slate-500">
                Open the Stores sheet. Paste one store per row under the header, or type over the example row. Store
                name and City are required. Store code is optional — leave it blank and a unique code is created.
              </p>
              <Button variant="secondary" onClick={() => void downloadStoreTemplate()}>
                <Download size={14} /> Download store template
              </Button>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="font-semibold text-slate-900">2. Upload the filled template</div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <div className="flex items-center gap-3">
                <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
                  <Upload size={14} /> {busy ? 'Checking…' : result ? 'Choose another file' : 'Upload Excel file'}
                </Button>
                {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
              </div>
            </div>

            {result && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                {result.rows.length > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                    {result.rows.length} {result.rows.length === 1 ? 'store is' : 'stores are'} ready to create.
                  </div>
                )}
                {result.errors.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                    <div className="font-semibold">
                      {result.rows.length > 0
                        ? `${result.errors.length} ${result.errors.length === 1 ? 'row' : 'rows'} will be skipped:`
                        : 'Nothing can be created yet:'}
                    </div>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                      {result.errors.slice(0, 8).map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                    {result.errors.length > 8 && <div className="mt-1 font-medium">…and {result.errors.length - 8} more</div>}
                  </div>
                )}
                {saveError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {saveError}
                  </div>
                )}
                {result.rows.length > 0 && (
                  <Button
                    className="w-full"
                    disabled={saving}
                    onClick={() => {
                      setSaving(true)
                      setSaveError(null)
                      void createStores(result.rows.map((r) => r.input))
                        .then(setCreated)
                        .catch((err: unknown) => {
                          setSaveError(err instanceof Error ? err.message : 'The stores could not be saved on the server.')
                        })
                        .finally(() => setSaving(false))
                    }}
                  >
                    {saving
                      ? 'Saving…'
                      : `Create ${result.rows.length} ${result.rows.length === 1 ? 'store' : 'stores'}`}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
