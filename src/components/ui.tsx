import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { Eye, EyeOff, Search, X } from 'lucide-react'

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function Card({
  children,
  className,
  padding = true,
}: {
  children: ReactNode
  className?: string
  padding?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-100 bg-white shadow-sm',
        padding && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/25',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  }
  const sizes: Record<ButtonSize, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  }
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Covered: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    LIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Certified: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Deployed: 'bg-sky-50 text-sky-700 ring-sky-200',
    Training: 'bg-violet-50 text-violet-700 ring-violet-200',
    Pending: 'bg-amber-50 text-amber-700 ring-amber-200',
    Invited: 'bg-sky-50 text-sky-700 ring-sky-200',
    Assessed: 'bg-brand-50 text-brand-700 ring-brand-500/20',
    Rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
    PLANNING: 'bg-amber-50 text-amber-700 ring-amber-200',
    COMPLETED: 'bg-slate-100 text-slate-600 ring-slate-200',
    PARTIAL: 'bg-amber-50 text-amber-700 ring-amber-200',
    'NEEDS BA': 'bg-rose-50 text-rose-700 ring-rose-200',
    High: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Medium: 'bg-amber-50 text-amber-700 ring-amber-200',
    Low: 'bg-rose-50 text-rose-700 ring-rose-200',
    Break: 'bg-amber-50 text-amber-700 ring-amber-200',
    Offline: 'bg-slate-100 text-slate-600 ring-slate-200',
    'Checked Out': 'bg-slate-100 text-slate-600 ring-slate-200',
    Submitted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Incomplete: 'bg-amber-50 text-amber-700 ring-amber-200',
    Assigned: 'bg-sky-50 text-sky-700 ring-sky-200',
    Scheduled: 'bg-sky-50 text-sky-700 ring-sky-200',
    Completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Missed: 'bg-rose-50 text-rose-700 ring-rose-200',
    Cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
    Open: 'bg-rose-50 text-rose-700 ring-rose-200',
    'In Review': 'bg-amber-50 text-amber-700 ring-amber-200',
    Resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  }
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        map[status] ?? 'bg-slate-100 text-slate-600 ring-slate-200',
      )}
    >
      {status}
    </span>
  )
}

export function ProgressBar({ value, color = 'bg-brand-500' }: { value: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
    </div>
  )
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  color = '#dc2626',
  label,
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
  label?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (Math.min(100, value) / 100) * c
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8eef8" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-slate-800">{value}%</span>
        {label && <span className="text-[9px] text-slate-500">{label}</span>}
      </div>
    </div>
  )
}

export function KpiCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string
  value: string | number
  delta?: string
  hint?: string
}) {
  return (
    <Card className="animate-fade-up">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{value}</div>
      {delta && <div className="mt-1 text-xs font-medium text-success">{delta}</div>}
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </Card>
  )
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <Search size={14} className="shrink-0 text-slate-400" />
      <input className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" {...props} />
    </div>
  )
}

/**
 * A password input hidden by default, with an eye button to reveal it — so a typed or
 * generated password can be checked before saving — and an optional Generate button.
 */
export function PasswordField({
  label = 'Password *',
  value,
  onChange,
  onGenerate,
  hint = 'At least 6 characters. You will see it once after saving.',
  autoFocus,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  onGenerate?: () => void
  hint?: string | false
  autoFocus?: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type={visible ? 'text' : 'password'}
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-3.5 font-mono text-sm outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
          >
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {onGenerate && (
          <Button type="button" variant="secondary" onClick={onGenerate}>
            Generate
          </Button>
        )}
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Select({
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
            value === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <div className="text-lg font-semibold text-slate-800">{title}</div>
      <p className="mt-2 max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  )
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label}
    </div>
  )
}

type ModalCtx = { open: boolean; setOpen: (v: boolean) => void }
const ModalContext = createContext<ModalCtx | null>(null)

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <ModalContext.Provider value={{ open, setOpen: onClose }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button className="absolute inset-0 bg-navy-950/50" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 w-full max-w-lg animate-fade-up rounded-2xl bg-white p-4 shadow-2xl sm:p-5 max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalContext.Provider>
  )
}

export function useModal() {
  return useContext(ModalContext)
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </div>
  )
}

/** Horizontal scroll wrapper for data tables. */
export function TableScroll({
  children,
  minWidth = 640,
  className,
}: {
  children: ReactNode
  minWidth?: number
  className?: string
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  )
}

export function ScoreBars({
  rows,
}: {
  rows: { label: string; value: number }[]
}) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-semibold text-slate-900">{row.value}%</span>
          </div>
          <ProgressBar value={row.value} />
        </div>
      ))}
    </div>
  )
}

export function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 w-8 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-16 w-16 text-xl' }
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-navy-900 font-semibold text-white',
        sizes[size],
      )}
    >
      {initials(name)}
    </div>
  )
}

export function useStableId(prefix: string) {
  const id = useId()
  return `${prefix}-${id}`
}

export function useFakeLoading(ms = 500) {
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms)
    return () => clearTimeout(t)
  }, [ms])
  return loading
}
