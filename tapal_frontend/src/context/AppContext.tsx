import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Role = 'headOffice' | 'admin' | 'storeManager' | 'supervisor' | 'ba' | 'shopper'

export const roleMeta: Record<
  Role,
  { label: string; short: string; home: string; tone: string }
> = {
  headOffice: {
    label: 'Head Office',
    short: 'HO',
    home: '/ho/dashboard',
    tone: 'Command Center',
  },
  admin: {
    label: 'Administrator',
    short: 'AD',
    home: '/admin/settings',
    tone: 'Platform Config',
  },
  storeManager: {
    label: 'Store Manager',
    short: 'SM',
    home: '/manager',
    tone: 'Field Operations',
  },
  supervisor: {
    label: 'Supervisor',
    short: 'SV',
    home: '/supervisor',
    tone: 'Store Oversight',
  },
  ba: {
    label: 'Brand Ambassador',
    short: 'BA',
    home: '/ba/home',
    tone: 'Floor Experience',
  },
  shopper: {
    label: 'Shopper',
    short: 'SH',
    home: '/shopper',
    tone: 'Mobile Web Journey',
  },
}

type RoleContextValue = {
  role: Role
  setRole: (role: Role) => void
}

const RoleContext = createContext<RoleContextValue | null>(null)

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('headOffice')
  const value = useMemo(() => ({ role, setRole }), [role])
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used within RoleProvider')
  return ctx
}

type DemoMetrics = {
  shoppers: number
  engagement: number
  conversion: number
  stores: number
  notifications: string[]
  sessionComplete: boolean
}

type DemoContextValue = DemoMetrics & {
  completeShopperSession: () => void
  clearNotifications: () => void
  resetDemo: () => void
}

const initial: DemoMetrics = {
  shoppers: 12842,
  engagement: 68.4,
  conversion: 31.7,
  stores: 24,
  notifications: [
    'Store #12 Lahore: high engagement / low conversion detected',
    '3 BAs awaiting certification review',
  ],
  sessionComplete: false,
}

const DemoContext = createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: ReactNode }) {
  const [metrics, setMetrics] = useState(initial)

  const completeShopperSession = useCallback(() => {
    setMetrics((m) => {
      if (m.sessionComplete) return m
      return {
        ...m,
        shoppers: m.shoppers + 1,
        conversion: Math.min(99, +(m.conversion + 0.1).toFixed(1)),
        engagement: Math.min(99, +(m.engagement + 0.05).toFixed(1)),
        sessionComplete: true,
        notifications: [
          'New shopper session synced · Store #12',
          'Consumer intelligence profile updated',
          'AI Optimization refreshed for Store #12',
          ...m.notifications,
        ],
      }
    })
  }, [])

  const clearNotifications = useCallback(() => {
    setMetrics((m) => ({ ...m, notifications: [] }))
  }, [])

  const resetDemo = useCallback(() => setMetrics(initial), [])

  const value = useMemo(
    () => ({ ...metrics, completeShopperSession, clearNotifications, resetDemo }),
    [metrics, completeShopperSession, clearNotifications, resetDemo],
  )

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export function useDemo() {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error('useDemo must be used within DemoProvider')
  return ctx
}
