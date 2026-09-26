import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  LayoutDashboard,
  Megaphone,
  Store,
  Users,
  Brain,
  FileBarChart,
  Settings,
  ShoppingBag,
  Trophy,
  Map,
  ClipboardList,
  ClipboardCheck,
  CalendarDays,
  Sparkles,
  LogOut,
  Banknote,
  Plus,
  UserCog,
  Menu,
  X,
  MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react'
import { roleMeta, useDemo, useRole, type Role } from '../context/AppContext'
import { useEffect, useState } from 'react'
import { cn } from './ui'
import { RoleSync } from './RoleLayouts'
import { signOut, useSupervisorSession } from '../lib/supervisors'
import {
  clearSupervisorNotifications,
  mergeRemoteNotifications,
  useSupervisorNotifications,
} from '../lib/supervisorNotifications'
import { enableSupervisorPush } from '../lib/supervisorPush'
import { useBrand } from '../context/BrandContext'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  section?: string
}

const headOfficeNav: NavItem[] = [
  { to: '/ho/dashboard', label: 'Campaign Metrics', icon: LayoutDashboard, end: true, section: 'Command' },
  { to: '/ho/ba-performance', label: 'Dashboard', icon: BarChart3, section: 'Command' },
  { to: '/ho/daily-reports', label: 'Daily Reports', icon: ClipboardList, section: 'Command' },
  { to: '/ho/ambassadors', label: 'Ambassadors', icon: Users, section: 'Operations' },
  { to: '/ho/stores', label: 'Stores', icon: Store, section: 'Operations' },
  { to: '/ho/supervisors', label: 'Supervisors', icon: UserCog, section: 'Operations' },
  { to: '/ho/deployment', label: 'Deployment', icon: Map, section: 'Operations' },
  { to: '/ho/complaints', label: 'Complaint Center', icon: MessageSquareWarning, section: 'Operations' },
  { to: '/ho/consumers', label: 'Consumers', icon: ShoppingBag, section: 'Intelligence' },
  { to: '/ho/optimization', label: 'AI Optimization', icon: Brain, section: 'Intelligence' },
  { to: '/ho/leaderboard', label: 'Leaderboard', icon: Trophy, section: 'Intelligence' },
  { to: '/ho/incentives', label: 'Incentives', icon: Banknote, section: 'Intelligence' },
  { to: '/ho/reports', label: 'Reports', icon: FileBarChart, section: 'Intelligence' },
]

const adminNav: NavItem[] = [
  { to: '/admin/settings', label: 'Campaign Config', icon: Settings, end: true, section: 'Platform' },
  { to: '/admin/ambassadors', label: 'BA Management', icon: Users, section: 'People' },
  { to: '/admin/stores', label: 'Stores', icon: Store, section: 'Network' },
  { to: '/admin/supervisors', label: 'Supervisors', icon: UserCog, section: 'Network' },
  { to: '/admin/campaigns', label: 'Campaigns', icon: Megaphone, section: 'Network' },
]

const managerNav: NavItem[] = [
  { to: '/manager', label: 'Dashboard', icon: LayoutDashboard, end: true, section: 'Today' },
  { to: '/manager/attendance', label: 'Attendance', icon: ClipboardCheck, section: 'Today' },
  { to: '/manager/coverage', label: 'Coverage', icon: Map, section: 'Today' },
  { to: '/manager/stores/12', label: 'My Store', icon: Store, section: 'Store' },
  { to: '/manager/stores', label: 'All Stores', icon: Store, end: true, section: 'Store' },
  { to: '/manager/stores/new', label: 'Create Store', icon: Plus, section: 'Store' },
  { to: '/manager/deployment', label: 'Deployment', icon: Sparkles, section: 'Store' },
]

const supervisorNav: NavItem[] = [
  { to: '/supervisor', label: 'Overview', icon: LayoutDashboard, end: true, section: 'My stores' },
  { to: '/supervisor/stores', label: 'Store Characteristics', icon: Store, section: 'My stores' },
  { to: '/supervisor/journey', label: 'Journey plan', icon: CalendarDays, section: 'My stores' },
  { to: '/supervisor/bas', label: 'BA Performance', icon: Users, section: 'My stores' },
  { to: '/supervisor/submissions', label: 'BA submissions', icon: ClipboardCheck, section: 'My stores' },
  { to: '/supervisor/complaints', label: 'Complaints', icon: MessageSquareWarning, section: 'My stores' },
]

type ShellKind = 'headOffice' | 'admin' | 'storeManager' | 'supervisor'

const shellConfig: Record<
  ShellKind,
  { role: Role; nav: NavItem[]; brand: string; subtitle: string }
> = {
  headOffice: {
    role: 'headOffice',
    nav: headOfficeNav,
    brand: 'Head Office',
    subtitle: 'Retail Command Center',
  },
  admin: {
    role: 'admin',
    nav: adminNav,
    brand: 'Administrator',
    subtitle: 'Platform configuration',
  },
  storeManager: {
    role: 'storeManager',
    nav: managerNav,
    brand: 'Store Manager',
    subtitle: 'Field operations',
  },
  supervisor: {
    role: 'supervisor',
    nav: supervisorNav,
    brand: 'Supervisor',
    subtitle: 'Store oversight',
  },
}

const titles: Record<string, string> = {
  '/ho/dashboard': 'Campaign Metrics',
  '/ho/ba-performance': 'Dashboard',
  '/ho/daily-reports': 'BA Daily Reports',
  '/ho/ambassadors': 'Ambassadors',
  '/ho/ambassadors/training': 'Training Content',
  '/ho/stores': 'Store Management',
  '/ho/stores/new': 'Create Store',
  '/ho/supervisors': 'Supervisors',
  '/admin/supervisors': 'Supervisors',
  '/supervisor': 'Supervisor Overview',
  '/supervisor/stores': 'Store Characteristics',
  '/supervisor/journey': 'Journey plan',
  '/supervisor/bas': 'BA Performance',
  '/supervisor/submissions': 'BA submissions',
  '/supervisor/complaints': 'Complaints',
  '/ho/deployment': 'Intelligent Deployment',
  '/ho/complaints': 'Complaint Center',
  '/ho/consumers': 'Consumer Intelligence',
  '/ho/optimization': 'AI Optimization',
  '/ho/leaderboard': 'Ambassador Leaderboard',
  '/ho/incentives': 'BA Performance Incentives',
  '/ho/reports': 'Executive Intelligence Report',
  '/admin/settings': 'Platform Settings',
  '/admin/ambassadors': 'BA Management',
  '/admin/stores': 'Stores',
  '/admin/stores/new': 'Create Store',
  '/admin/campaigns': 'Campaigns',
  '/manager': 'Store Manager Dashboard',
  '/manager/attendance': 'BA Attendance',
  '/manager/coverage': 'Store Coverage',
  '/manager/stores': 'Stores',
  '/manager/stores/new': 'Create Store',
  '/manager/deployment': 'Deployment',
}

function FilledIcon({
  icon: Icon,
  size = 15,
  className,
}: {
  icon: LucideIcon
  size?: number
  className?: string
}) {
  return <Icon size={size} className={className} fill="currentColor" strokeWidth={1.5} />
}

function groupNav(items: NavItem[]) {
  const groups: { section: string; items: NavItem[] }[] = []
  for (const item of items) {
    const section = item.section ?? 'Menu'
    const last = groups[groups.length - 1]
    if (last && last.section === section) last.items.push(item)
    else groups.push({ section, items: [item] })
  }
  return groups
}

export function DesktopShell({ kind }: { kind: ShellKind }) {
  const cfg = shellConfig[kind]
  const { brand } = useBrand()
  const { role, setRole } = useRole()
  const demo = useDemo()
  const sv = useSupervisorSession()
  const checkInNotes = useSupervisorNotifications(kind === 'supervisor' ? sv.supervisor?.id : undefined)
  const notifications = kind === 'supervisor' ? checkInNotes.map((n) => n.message) : demo.notifications
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [bellOpen, setBellOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const meta = roleMeta[role]
  const navGroups = groupNav(cfg.nav)

  useEffect(() => {
    setRole(cfg.role)
  }, [cfg.role, setRole])

  useEffect(() => {
    setSidebarOpen(false)
    setBellOpen(false)
  }, [pathname])

  useEffect(() => {
    if (kind !== 'supervisor' || !sv.supervisor || sv.preview) return
    const supervisorId = sv.supervisor.id
    void enableSupervisorPush(supervisorId).catch((error) => {
      console.error('[push] token registration failed', error)
    })
    let stop = false
    async function pull() {
      try {
        const response = await fetch(`/api/push/inbox?supervisorId=${encodeURIComponent(supervisorId)}`)
        if (!response.ok) return
        const data = (await response.json()) as {
          events: { id: string; supervisorId: string; body: string; createdAt: string }[]
        }
        if (!stop) mergeRemoteNotifications(data.events ?? [])
      } catch {
        // the dev push server is optional
      }
    }
    void pull()
    const id = window.setInterval(() => void pull(), 8000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [kind, sv.supervisor, sv.preview])

  const title =
    titles[pathname] ??
    (pathname === '/ho/ambassadors/training' || pathname.endsWith('/ambassadors/training')
      ? 'Training Content'
      : pathname.includes('/ambassadors/')
      ? 'Ambassador Profile'
      : pathname.includes('/stores/')
        ? 'Store Detail'
        : pathname.includes('/supervisors/')
          ? 'Supervisor'
          : cfg.subtitle)

  function handleSignOut() {
    if (kind === 'supervisor') {
      signOut()
      navigate(sv.preview ? '/ho/supervisors' : '/supervisor/login')
      return
    }
    navigate('/login')
  }

  return (
    <div className="flex min-h-[100dvh] bg-surface">
      <RoleSync role={cfg.role} />

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-navy-950/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-dvh w-[min(272px,88vw)] shrink-0 flex-col overflow-hidden bg-navy-950 text-white transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:w-[272px] lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Soft CSS atmosphere — no photo background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_0%_-10%,rgba(249,176,0,0.16),transparent_55%),radial-gradient(ellipse_70%_45%_at_100%_110%,rgba(255,255,255,0.07),transparent_50%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent"
        />

        {/* Brand lockup */}
        <div className="relative z-[1] flex items-center justify-between px-4 pt-5 pb-4">
          <div className="min-w-0 flex-1 rounded-2xl bg-white p-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.45)] ring-1 ring-white/40 sm:p-3.5">
            <img
              src={brand.logo}
              alt={brand.productName}
              className="mx-auto h-12 w-auto max-w-full object-contain sm:h-14 lg:h-16"
            />
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            className="ml-2 rounded-xl p-2 text-white/70 hover:bg-white/10 lg:hidden"
          >
            <X size={20} />
          </button>
          {/* <div className="mt-3.5 px-1">
            <div className="text-[10px] font-semibold tracking-[0.2em] text-gold-400 uppercase">
              {cfg.brand}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-white">{brand.productName}</div>
            <div className="truncate text-[11px] text-white/55">{cfg.subtitle}</div>
          </div> */}
          <div className="mt-4 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>

        <nav className="relative z-[1] min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-3">
          {navGroups.map(({ section, items }) => (
            <div key={section}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.18em] text-white/35 uppercase">
                {section}
              </div>
              <div className="space-y-0.5">
                {items.map(({ to, label, icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        // Keep a constant transparent border so active/inactive don't shift layout.
                        // Avoid transition-all — it interpolates the gradient border and flashes on deselect.
                        'group flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-sm font-medium transition-colors duration-200',
                        isActive
                          ? 'bg-[linear-gradient(rgba(255,255,255,0.12),rgba(255,255,255,0.12)),linear-gradient(to_right,rgba(249,176,0,0.85),transparent)] bg-origin-border [background-clip:padding-box,border-box] text-white'
                          : 'text-white/70 hover:bg-white/6 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                            isActive
                              ? 'bg-gold-500 text-navy-950 shadow-lg shadow-gold-500/35'
                              : 'bg-white/8 text-white/80 group-hover:bg-white/12',
                          )}
                        >
                          <FilledIcon icon={icon} size={15} />
                        </span>
                        <span className="min-w-0 truncate">{label}</span>
                        {isActive && (
                          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400 shadow-[0_0_8px_rgba(249,176,0,0.8)]" />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="relative z-[1] border-t border-white/10 bg-black/20 p-3 backdrop-blur-sm">
          <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-white/8 px-2.5 py-2.5 ring-1 ring-white/10">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-gold-400 to-gold-600 text-[11px] font-bold text-navy-950 shadow-md shadow-gold-500/25">
              {meta.short}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-white">{cfg.brand}</div>
              <div className="truncate text-[10px] text-white/55">{meta.label}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-[56px] items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:gap-4 sm:px-4 lg:h-[72px] lg:px-6 lg:py-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
              className="shrink-0 rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
            >
              <Menu size={18} />
            </button>
            <div className="min-w-0">
              <div className="truncate text-xs font-bold tracking-wide text-slate-800 uppercase sm:text-sm">
                Intelligent Brand Ambassador Ecosystem
              </div>
              <div className="hidden truncate text-[11px] font-medium tracking-wide text-slate-500 uppercase sm:block">
                AI-Powered In-Store Engagement
              </div>
              <div className="truncate text-[10px] text-slate-400 sm:text-[11px]">{title}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="relative">
              <button
                onClick={() => setBellOpen((v) => !v)}
                className="relative rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              >
                <FilledIcon icon={Bell} size={16} />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-100 bg-white p-3 shadow-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold">Notifications</div>
                    <button
                      className="text-xs text-brand-600"
                      onClick={() => {
                        if (kind === 'supervisor' && sv.supervisor) clearSupervisorNotifications(sv.supervisor.id)
                        else demo.clearNotifications()
                        setBellOpen(false)
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">No notifications</p>
                  ) : (
                    <ul className="max-h-60 space-y-2 overflow-auto">
                      {notifications.map((n) => (
                        <li key={n} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">
                  {meta.short}
                </div>
                <div className="hidden text-left sm:block">
                  <div className="text-xs font-semibold text-slate-800">
                    {kind === 'supervisor' ? (sv.supervisor?.name ?? cfg.brand) : cfg.brand}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {kind === 'supervisor' && sv.preview ? 'Head Office preview' : meta.label}
                  </div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">{kind === 'supervisor' && sv.preview ? 'Exit preview' : 'Sign out'}</span>
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** @deprecated use DesktopShell */
export const AppShell = () => <DesktopShell kind="headOffice" />
