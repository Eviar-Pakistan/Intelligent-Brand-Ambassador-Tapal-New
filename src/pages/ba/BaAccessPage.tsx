import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { baSignIn, findBaByAccessToken } from '../../lib/baAccounts'

/** Opens one ambassador's account from their personal link. No password. */
export function BaAccessPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const account = token ? findBaByAccessToken(token) : null
    if (!account) {
      setMissing(true)
      return
    }
    baSignIn(account.id)
    navigate(account.status === 'Certified' ? '/ba/home' : '/ba/training', { replace: true })
  }, [token, navigate])

  if (!missing) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#f7f4ec] px-6 text-sm text-slate-600">
        Opening your account…
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f7f4ec] px-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-bold text-slate-900">This link is not valid</h1>
        <p className="mt-2 text-sm text-slate-500">Ask Head Office for your account link.</p>
      </div>
    </div>
  )
}
