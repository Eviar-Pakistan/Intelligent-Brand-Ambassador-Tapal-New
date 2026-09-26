import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { roleMeta, useRole } from '../context/AppContext'
import { useBrand } from '../context/BrandContext'
import { Button } from '../components/ui'
import { emailInUse, signOut } from '../lib/supervisors'
import { baEmailInUse, baSignOut } from '../lib/baAccounts'

export function LoginPage() {
  const navigate = useNavigate()
  const { setRole } = useRole()
  const { brand } = useBrand()
  const [email, setEmail] = useState(brand.loginEmail)
  const [password, setPassword] = useState('••••••••')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()

    if (emailInUse(email)) {
      setError('Supervisors use their own sign-in page.')
      return
    }

    // Ambassadors do not use this form. They open the personal link Head Office gives them.
    if (baEmailInUse(email)) {
      setError('Brand Ambassadors open their personal account link. Ask Head Office for it.')
      return
    }

    // Anyone else enters the Head Office demo, as before
    signOut()
    baSignOut()
    setRole('headOffice')
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

       
          <h2 className="mt-4 text-xl font-bold text-slate-900 sm:text-2xl">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            {brand.productName} · Or jump straight into a role experience
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                autoComplete="username"
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
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}
            <Button type="submit" className="w-full" size="lg">
              Sign In
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
