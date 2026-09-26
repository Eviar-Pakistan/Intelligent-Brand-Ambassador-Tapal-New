import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, MessageSquareWarning, UserRound } from 'lucide-react'
import { ambassadors, stores } from '../../data/mock'
import { useBaSession } from '../../lib/baAccounts'
import {
  complaintBrands,
  complaintCategories,
  type ComplaintCategory,
  type ComplaintKind,
} from '../../data/complaints'
import { useComplaints } from '../../context/ComplaintsContext'

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-[#faf6ee] px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15'

export function BaComplaintPage() {
  const navigate = useNavigate()
  const { submitComplaint } = useComplaints()
  const { account } = useBaSession()
  const ba = ambassadors.find((a) => a.id === account?.id)
  const baId = account?.id ?? ba?.id ?? 'ayesha'
  const baName = account?.name ?? ba?.name ?? 'Ayesha Khan'

  const storeOptions = useMemo(
    () =>
      [...stores]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ id: s.id, name: s.name, city: s.city })),
    [],
  )

  const [kind, setKind] = useState<ComplaintKind>('customer')
  const [customerStoreId, setCustomerStoreId] = useState(ba?.storeId ? String(ba.storeId) : '')

  const [brand, setBrand] = useState('')
  const [sku, setSku] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerNumber, setCustomerNumber] = useState('')
  const [complaint, setComplaint] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [storeId, setStoreId] = useState('')
  const [category, setCategory] = useState<ComplaintCategory | ''>('')
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [submittedId, setSubmittedId] = useState<string | null>(null)

  const skuOptions = complaintBrands.find((b) => b.name === brand)?.skus ?? []
  const phoneDigits = customerNumber.replace(/\D/g, '')

  const canSubmitCustomer =
    customerStoreId !== '' &&
    brand !== '' &&
    sku !== '' &&
    customerName.trim().length >= 2 &&
    phoneDigits.length >= 10 &&
    phoneDigits.length <= 13 &&
    complaint.trim().length >= 8

  const canSubmitBa =
    storeId !== '' && category !== '' && subject.trim().length >= 4 && details.trim().length >= 12

  const canSubmit = kind === 'customer' ? canSubmitCustomer : canSubmitBa

  function handleBrandChange(next: string) {
    setBrand(next)
    setSku('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    if (kind === 'customer') {
      const store = storeOptions.find((s) => String(s.id) === customerStoreId)
      if (!store) return
      const created = submitComplaint({
        kind: 'customer',
        baId,
        baName,
        storeId: store.id,
        storeName: store.name,
        city: store.city,
        brand,
        sku,
        customerName: customerName.trim(),
        customerNumber: phoneDigits,
        complaint: complaint.trim(),
        ...(image ? { image } : {}),
      })
      setSubmittedId(created.id)
      return
    }

    const store = storeOptions.find((s) => String(s.id) === storeId)
    if (!store || !category) return

    const created = submitComplaint({
      kind: 'ba',
      baId,
      baName,
      storeId: store.id,
      storeName: store.name,
      city: store.city,
      category,
      subject: subject.trim(),
      details: details.trim(),
    })
    setSubmittedId(created.id)
  }

  if (submittedId) {
    return (
      <div className="flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-center bg-[#f7f4ec] px-4 py-10 text-center">
        <CheckCircle2 className="text-brand-600" size={48} strokeWidth={1.75} />
        <h2 className="mt-4 text-xl font-bold text-slate-900">Complaint submitted</h2>
        <p className="mt-2 max-w-xs text-sm text-slate-500">
          Head Office can now review this {kind === 'customer' ? 'customer' : 'BA'} complaint.
          Reference ID <span className="font-semibold text-slate-700">{submittedId}</span>.
        </p>
        <button
          type="button"
          onClick={() => navigate('/ba/home')}
          className="mt-8 w-full max-w-xs rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
        >
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-[#f7f4ec] p-4 pb-8">
      <div className="mb-4 flex items-start gap-3">
        <button
          type="button"
          onClick={() => navigate('/ba/home')}
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Submit Complaint</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            File a customer product complaint or a BA store complaint
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TypeButton
          active={kind === 'customer'}
          icon={<UserRound size={16} />}
          label="Customer Complaint"
          onClick={() => setKind('customer')}
        />
        <TypeButton
          active={kind === 'ba'}
          icon={<MessageSquareWarning size={16} />}
          label="BA Complaint"
          onClick={() => setKind('ba')}
        />
      </div>

      {kind === 'customer' ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-navy-900">
            Customer Complaint
          </h3>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Store</span>
            <select
              value={customerStoreId}
              onChange={(e) => setCustomerStoreId(e.target.value)}
              className={fieldClass}
              required
            >
              <option value="">Choose a store…</option>
              {storeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.city}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Brand</span>
            <select
              value={brand}
              onChange={(e) => handleBrandChange(e.target.value)}
              className={fieldClass}
              required
            >
              <option value="">Select brand…</option>
              {complaintBrands.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">SKU Selection</span>
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className={fieldClass}
              required
              disabled={!brand}
            >
              <option value="">{brand ? 'Select SKU…' : 'Select a brand first'}</option>
              {skuOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Name</span>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
              maxLength={60}
              className={fieldClass}
              required
            />
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Number</span>
            <input
              type="tel"
              inputMode="numeric"
              value={customerNumber}
              onChange={(e) => setCustomerNumber(e.target.value)}
              placeholder="03xx xxx xxxx"
              maxLength={16}
              className={fieldClass}
              required
            />
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Complaint</span>
            <textarea
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
              rows={5}
              placeholder="What did the customer report about this product?"
              className={fieldClass}
              required
            />
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Image</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0]
                void readComplaintImage(file).then(
                  (dataUrl) => {
                    setImage(dataUrl)
                    setImageError(null)
                  },
                  (err: unknown) => {
                    setImage(null)
                    setImageError(err instanceof Error ? err.message : 'Could not read that image')
                  },
                )
              }}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
            />
            {imageError && <p className="mt-1 text-xs text-rose-600">{imageError}</p>}
            {image && (
              <img
                src={image}
                alt="Complaint attachment"
                className="mt-3 max-h-48 w-full rounded-xl object-contain ring-1 ring-slate-200"
              />
            )}
          </label>
        </section>
      ) : (
        <>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-navy-900">Store</h3>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Select store</span>
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className={fieldClass}
                required
              >
                <option value="">Choose a store…</option>
                {storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.city}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-navy-900">
              BA Complaint
            </h3>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
                className={fieldClass}
                required
              >
                <option value="">Select category…</option>
                {complaintCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Short summary of the issue"
                maxLength={80}
                className={fieldClass}
                required
              />
            </label>

            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Details</span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={5}
                placeholder="Describe what happened, when, and any impact on your work"
                className={fieldClass}
                required
              />
            </label>
          </section>
        </>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45"
      >
        Submit to Head Office
      </button>
    </form>
  )
}

function readComplaintImage(file: File | undefined) {
  if (!file) return Promise.resolve(null)
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('Choose an image file'))
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('Image must be under 8 MB'))
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that image'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const max = 1280
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not prepare that image'))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.onerror = () => reject(new Error('Could not read that image'))
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function TypeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-semibold transition ${
        active
          ? 'bg-navy-900 text-white shadow-md shadow-navy-900/20'
          : 'bg-white text-slate-600 ring-1 ring-black/5'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
