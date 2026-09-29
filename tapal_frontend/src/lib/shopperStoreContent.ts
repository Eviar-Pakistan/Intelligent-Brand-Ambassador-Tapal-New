import { useEffect, useState } from 'react'
import { useBrand } from '../context/BrandContext'
import { selectionReasons, surveyOptions } from '../pages/shopper/shopperData'
import { getShopperStore } from './storeRegistry'

/**
 * What a shopper sees can be set per store by Head Office (Stores → store → Survey & rewards):
 *   survey question 1 → "Which tea do you currently use?" and its options
 *   survey question 2 → the reasons question (several answers allowed)
 *   the featured reward → the spin prize, amount and promo code
 * A store with nothing set uses the standard text below.
 */

type Question = { id: number; store: number | null; order: number; text: string; options: string[]; is_active: boolean }
type Reward = {
  label: string
  win_amount: string
  win_detail: string
  promo_code: string
  is_active: boolean
  is_featured: boolean
}

export type ShopperContent = {
  current: { text: string; options: string[] }
  reasons: { text: string; options: string[] }
  spin: { prizeLabels: string[]; winAmount: string; winDetail: string; promoCode: string }
}

const cache = new Map<string, Promise<{ questions: Question[]; rewards: Reward[] }>>()

function load(slug: string) {
  let pending = cache.get(slug)
  if (!pending) {
    const get = <T,>(path: string) =>
      fetch(path)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : ([] as T)))
        .catch(() => [] as T)
    pending = Promise.all([
      get<Question[]>(`/api/shopper/questions/?store=${encodeURIComponent(slug)}`),
      get<Reward[]>(`/api/shopper/store/${encodeURIComponent(slug)}/rewards/`),
    ]).then(([questions, rewards]) => ({ questions, rewards }))
    cache.set(slug, pending)
  }
  return pending
}

export function useShopperContent(): ShopperContent {
  const { brand } = useBrand()
  const fallback: ShopperContent = {
    current: { text: 'Which tea do you currently use?', options: surveyOptions },
    reasons: { text: 'Reason for selection', options: selectionReasons },
    spin: {
      prizeLabels: brand.shopperSpin.prizeLabels,
      winAmount: brand.shopperSpin.winAmount,
      winDetail: brand.shopperSpin.winDetail,
      promoCode: brand.shopperSpin.promoCode,
    },
  }
  const [content, setContent] = useState<ShopperContent>(fallback)

  useEffect(() => {
    const store = getShopperStore()
    if (!store?.slug) return
    let cancelled = false
    void load(store.slug).then(({ questions, rewards }) => {
      if (cancelled) return
      // Only this store's own questions; shared default questions keep the standard journey.
      const mine = Array.isArray(questions) ? questions.filter((q) => q.store === store.id && q.options?.length) : []
      const q1 = mine.find((q) => q.order === 1)
      const q2 = mine.find((q) => q.order === 2)
      const active = Array.isArray(rewards) ? rewards.filter((r) => r.is_active) : []
      const prize = active.find((r) => r.is_featured) ?? active[0]
      setContent((prev) => ({
        current: q1 ? { text: q1.text, options: q1.options } : prev.current,
        reasons: q2 ? { text: q2.text, options: q2.options } : prev.reasons,
        spin: prize
          ? {
              prizeLabels: active.slice(0, 3).map((r) => r.label),
              winAmount: prize.win_amount,
              winDetail: prize.win_detail,
              promoCode: prize.promo_code || prev.spin.promoCode,
            }
          : prev.spin,
      }))
    })
    return () => {
      cancelled = true
    }
  }, [])

  return content
}
