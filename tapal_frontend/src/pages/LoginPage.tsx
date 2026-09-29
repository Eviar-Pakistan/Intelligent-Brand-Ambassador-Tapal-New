import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { roleMeta, useRole } from '../context/AppContext'
import { useBrand } from '../context/BrandContext'
import { DesktopShell } from '../components/AppShell'
import { Button } from '../components/ui'
import { emailInUse, signOut } from '../lib/supervisors'
import { baEmailInUse, baSignOut } from '../lib/baAccounts'
import { djangoLogin, djangoMe } from '../lib/djangoApi'
import { syncDjango } from '../lib/djangoSync'

export function HeadOfficeGate() {
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    let stop = false
    void djangoMe().then((user) => {
      if (!stop) setAllowed(user?.user_type === 1)
    })
    return () => {
      stop = true
    }
  }, [])

  if (allowed === null) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-surface text-sm text-slate-500">
        Checking sign-in…
      </div>
    )
  }
  if (!allowed) return <Navigate to="/login" replace />
  return <DesktopShell kind="headOffice" />
}

export function LoginPage() {
  const navigate = useNavigate()
  const { setRole } = useRole()
  const { brand } = useBrand()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return

    if (emailInUse(email)) {
      setError('Supervisors use their own sign-in page.')
      return
    }

    if (baEmailInUse(email)) {
      setError('Brand Ambassadors open their personal account link. Ask Head Office for it.')
      return
    }

    setBusy(true)
    const result = await djangoLogin(email, password)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    signOut()
    baSignOut()
    setRole('headOffice')
    void syncDjango()
    navigate(roleMeta.headOffice.home)
  }

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-black p-8 text-white xl:p-12 lg:flex lg:flex-col lg:justify-between">
        <img
          src={brand.sidebar}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-55"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40" />
        <div className="relative">
          <img src={brand.logo} alt={brand.productName} className="h-16 w-auto object-contain" />
          <h1 className="mt-8 max-w-md text-3xl font-bold leading-tight xl:text-4xl">
            Intelligent Brand Ambassador Ecosystem
          </h1>
          
        </div>
  
      </div>

      <div className="safe-bottom flex items-center justify-center bg-surface px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-md">
          <div className="mb-4 lg:mb-6 lg:hidden">
            <img src={brand.logo} alt={brand.productName} className="h-10 w-auto object-contain sm:h-12" />
          </div>

       
          <h2 className="mt-4 text-xl font-bold text-slate-900 sm:text-2xl">Head Office sign in</h2>
          <p className="mt-1 text-sm text-slate-500">{brand.productName}</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  className="w-full rounded-xl border border-slate-200 py-2.5 pr-11 pl-3.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((open) => !open)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
          <Link to="/supervisor/login" className="mt-4 inline-block text-sm font-semibold text-brand-700">
            Supervisor sign in
          </Link>

          
     
        </div>
      </div>
    </div>
  )
}
