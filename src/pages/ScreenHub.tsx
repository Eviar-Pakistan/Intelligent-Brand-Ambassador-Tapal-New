import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Settings,
  ClipboardCheck,
  UserCog,
  Smartphone,
  QrCode,
} from 'lucide-react'
import { roleMeta, useRole, type Role } from '../context/AppContext'
import { BrandMark } from '../components/BrandMark'

const experiences: {
  role: Role
  icon: typeof LayoutDashboard
  title: string
  desc: string
  layout: string
}[] = [
  {
    role: 'headOffice',
    icon: LayoutDashboard,
    title: 'Head Office',
    desc: 'Command Center, campaigns, BAs, stores, AI optimization & reports',
    layout: 'Desktop dashboard',
  },
  {
    role: 'admin',
    icon: Settings,
    title: 'Administrator',
    desc: 'Certification rules, scenarios, stores, users & campaign config',
    layout: 'Desktop admin',
  },
  {
    role: 'storeManager',
    icon: ClipboardCheck,
    title: 'Store Manager',
    desc: 'Attendance, GPS status, coverage and store deployment',
    layout: 'Desktop operations',
  },
  {
    role: 'supervisor',
    icon: UserCog,
    title: 'Supervisor',
    desc: 'Their assigned stores — BA performance, store characteristics and own incentive',
    layout: 'Desktop oversight',
  },
  {
    role: 'ba',
    icon: Smartphone,
    title: 'Brand Ambassador',
    desc: 'Shift home, AI training and rewards',
    layout: 'Full-screen BA app',
  },
  {
    role: 'shopper',
    icon: QrCode,
    title: 'Shopper',
    desc: 'QR web journey — product, spin, AI, survey, reward',
    layout: 'Full-screen mobile web',
  },
]

export function ScreenHub() {
  const { setRole } = useRole()
  const navigate = useNavigate()

  function open(role: Role) {
    if (role === 'headOffice') {
      navigate('/login')
      return
    }
    setRole(role)
    navigate(roleMeta[role].home)
  }

  return (
    <div className="min-h-[100dvh] bg-surface">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
        <BrandMark variant="dark" />
        <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-brand-600 uppercase">
          Experience portal
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Choose a role to enter</h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Each role opens its own dedicated experience — desktop for Head Office, Admin, and Manager,
          and full-screen apps for BA and Shopper.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {experiences.map(({ role, icon: Icon, title, desc, layout }) => (
            <button
              key={role}
              onClick={() => open(role)}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-md"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 text-white">
                <Icon size={20} />
              </div>
              <div className="mt-4 text-lg font-semibold text-slate-900">{title}</div>
              <p className="mt-1 text-sm text-slate-500">{desc}</p>
              <div className="mt-3 text-[11px] font-semibold tracking-wide text-brand-600 uppercase">
                {layout}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
