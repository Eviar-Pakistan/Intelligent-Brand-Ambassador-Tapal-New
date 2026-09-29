import { createContext } from 'react'
import type { BaShiftState } from './BaShiftContext'

/**
 * The BA shift context lives in its own file on purpose: this file never changes, so a hot reload
 * of BaShiftContext.tsx (or anything it imports) keeps the same context object and the BA pages
 * stay connected to the provider.
 */
export const BaShiftContext = createContext<BaShiftState | null>(null)
