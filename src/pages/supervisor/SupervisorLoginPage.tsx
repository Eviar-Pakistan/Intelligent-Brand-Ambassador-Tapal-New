import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRole } from '../../context/AppContext'
import { useBrand } from '../../context/BrandContext'
import { authenticate, signIn } from '../../lib/supervisors'
import { enableSupervisorPush } from '../../lib/supervisorPush'

export function SupervisorLoginPage() {
  const navigate = useNavigate()
  const { setRole } = useRole()
  const { brand } = useBrand()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const supervisor = authenticate(email, password)
    if (!supervisor) {
      setError('Incorrect email or password.')
      return
    }
    setBusy(true)
    try {
      await enableSupervisorPush(supervisor.id)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Allow notifications to continue.')
      return
    }
    setRole('supervisor')
    signIn(supervisor.id)
    navigate('/supervisor')
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f7f4ec] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
        <img src={brand.logo} alt={brand.productName} className="h-12 w-auto object-contain" />
        <h1 className="mt-6 text-2xl font-bold text-slate-900">Supervisor sign in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your stores only. Notifications must be allowed so you are alerted when a BA checks in or out.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-navy-900 py-3 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Waiting for notifications…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-xs text-slate-500">
          Demo: imran.sheikh@example.com · Imran@123, or nadia.hussain@example.com · Nadia@123
        </p>
        <Link to="/login" className="mt-4 inline-block text-sm font-semibold text-brand-700">
          Head Office sign in
        </Link>
      </div>
    </div>
  )
}
