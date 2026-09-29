import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Home,
  GraduationCap,
  Trophy,
  ArrowLeft,
  LogOut,
  MessageSquareWarning,
} from 'lucide-react'
import { useEffect } from 'react'
import { useRole, type Role } from '../context/AppContext'
import { cn } from './ui'
import { useBrand } from '../context/BrandContext'
import { BaShiftProvider } from '../context/BaShiftContext'
import { baSignOut, useBaSession } from '../lib/baAccounts'

/** Sync active role from URL prefix so each experience stays isolated. */
export function RoleSync({ role }: { role: Role }) {
  const { setRole } = useRole()
  useEffect(() => {
    setRole(role)
  }, [role, setRole])
  return null
}

const baTabs = [
  { to: '/ba/home', label: 'Home', icon: Home, end: true },
  { to: '/ba/training', label: 'Training', icon: GraduationCap },
  { to: '/ba/complaint', label: 'Complaint', icon: MessageSquareWarning },
  { to: '/ba/performance', label: 'Rewards', icon: Trophy },
]

export function BaShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { brand } = useBrand()
  const { account } = useBaSession()

  if (!account) return <Navigate to="/login" replace />

  // A newly created BA can only use Training until they pass the assessment
  const onboarding = account.status !== 'Certified'
  if (onboarding && pathname !== '/ba/training') return <Navigate to="/ba/training" replace />
  const locked = onboarding

  return (
    <BaShiftProvider>
      <div className="flex min-h-[100dvh] flex-col bg-slate-50">
        <RoleSync role="ba" />
        <header className="safe-top sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 w-full max-w-lg items-center justify-between gap-2 px-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.16em] text-brand-600 uppercase">
                {brand.productName} · BA
              </div>
              <div className="truncate text-sm font-bold text-slate-900">
                {account.name} · {account.status === 'Certified' ? 'Certified' : 'Training'}
              </div>
            </div>
            <button
              onClick={() => {
                baSignOut()
                navigate('/login')
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <LogOut size={13} /> Exit
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-lg flex-1 overflow-x-hidden overflow-y-auto px-4 pb-[calc(4.75rem+env(safe-area-inset-bottom))]">
          <Outlet />
        </main>

        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-[3.75rem] w-full max-w-lg items-stretch px-1 pb-[env(safe-area-inset-bottom)]">
            {baTabs.map(({ to, label, icon: Icon, end }) =>
              locked && to !== '/ba/training' ? (
                <span
                  key={to}
                  aria-disabled
                  title="Complete the training assessment to unlock"
                  className="flex min-w-0 flex-1 cursor-not-allowed flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold text-slate-300"
                >
                  <Icon size={20} strokeWidth={2.25} />
                  <span className="leading-none">{label}</span>
                </span>
              ) : (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold',
                    isActive ? 'text-brand-600' : 'text-slate-400',
                  )
                }
              >
                <Icon size={20} strokeWidth={2.25} />
                <span className="leading-none">{label}</span>
              </NavLink>
              ),
            )}
          </div>
        </nav>
      </div>
    </BaShiftProvider>
  )
}

const shopperSteps = [
  '/shopper',
  '/shopper/survey',
  '/shopper/product',
  '/shopper/spin',
  '/shopper/reward',
  '/shopper/feedback',
  '/shopper/thanks',
]

export function ShopperShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { brand } = useBrand()
  const stepIndex = Math.max(
    0,
    shopperSteps.findIndex((s) => s === pathname || (s !== '/shopper' && pathname.startsWith(s))),
  )
  const progress = ((stepIndex + 1) / shopperSteps.length) * 100
  const backTo = stepIndex > 0 ? shopperSteps[stepIndex - 1] : null
  const hideChrome =
    pathname === '/shopper' || pathname === '/shopper/spin' || pathname === '/shopper/thanks'

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      <RoleSync role="shopper" />
      {!hideChrome && (
        <header className="safe-top sticky top-0 z-20 border-b border-slate-100 bg-white">
          <div className="mx-auto flex max-w-lg items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
            {backTo ? (
              <Link to={backTo} className="rounded-lg p-1 text-slate-500 hover:bg-slate-50">
                <ArrowLeft size={18} />
              </Link>
            ) : (
              <span className="w-7" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold tracking-[0.16em] text-brand-600 uppercase">
                {brand.productName}
              </div>
              <div className="truncate text-sm font-semibold text-slate-900">In-store experience</div>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="text-[11px] font-medium text-slate-400 hover:text-slate-600"
            >
              Exit
            </button>
          </div>
          <div className="h-1 bg-slate-100">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </header>
      )}
      <main className="mx-auto w-full max-w-lg flex-1 overflow-x-hidden pb-[env(safe-area-inset-bottom)]">
        <Outlet />
      </main>
    </div>
  )
}
