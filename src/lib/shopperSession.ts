import { getShopperStore } from './storeRegistry'

/**
 * Saves the shopper's in-store journey on the server: the survey answers
 * (/api/shopper/sessions/) and then the feedback rating on that same session.
 */

const CONSUMER_KEY = 'shopper-consumer-id'

export type ShopperSurvey = {
  name: string
  phone: string
  gender: string
  age: string
  currentBrand: string
  reasons: string[]
  consent: boolean
}

export async function saveShopperSurvey(survey: ShopperSurvey) {
  const store = getShopperStore()
  if (!store || (!store.slug && store.id == null)) return
  try {
    const response = await fetch('/api/shopper/sessions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: store.slug, storeId: store.id, ...survey }),
    })
    if (!response.ok) return
    const data = (await response.json()) as { id: number }
    sessionStorage.setItem(CONSUMER_KEY, String(data.id))
  } catch {
    // the journey continues; the answers are not saved
  }
}

export async function saveShopperFeedback(rating: number, comment: string) {
  let id: string | null = null
  try {
    id = sessionStorage.getItem(CONSUMER_KEY)
  } catch {
    id = null
  }
  if (!id) return
  try {
    await fetch(`/api/shopper/consumers/${encodeURIComponent(id)}/feedback/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback_rating: rating, feedback_comment: comment.trim() }),
    })
    sessionStorage.removeItem(CONSUMER_KEY)
  } catch {
    // feedback is optional for the journey
  }
}
