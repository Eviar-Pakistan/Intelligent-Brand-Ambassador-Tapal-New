import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { brand, type BrandConfig } from '../brands/config'

type BrandContextValue = {
  brand: BrandConfig
}

const BrandContext = createContext<BrandContextValue | null>(null)

export function BrandProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => ({ brand }), [])

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrand() {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error('useBrand must be used within BrandProvider')
  return ctx
}
