import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import { Button } from '../../components/ui'
import { useDemo } from '../../context/AppContext'
import { useBrand } from '../../context/BrandContext'
import { Check, Gift, Leaf, Lock, Percent, Sparkles, Ticket } from 'lucide-react'
import { productCategories, selectionReasons, surveyOptions } from './shopperData'
import { getShopperStore } from '../../lib/storeRegistry'

export function ShopperLandingPage() {
  const { brand } = useBrand()
  const [line1, line2] = brand.shopperHeadline
  const shopperStore = getShopperStore()

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#f7f4ec] text-slate-900">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#e8e2d2] via-[#f0ebe0]/70 to-transparent" />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center px-8 pb-10 pt-12 text-center">
        <img
          src={brand.logo}
          alt={brand.productName}
          className="h-[4.5rem] w-auto object-contain sm:h-20"
        />

        {shopperStore && (
          <div className="mt-4 rounded-full bg-white/80 px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-black/5">
            Welcome to {shopperStore.name}
            {shopperStore.city ? ` · ${shopperStore.city}` : ''}
          </div>
        )}

        <h1 className="mt-6 font-display text-[1.7rem] font-bold leading-[1.2] tracking-tight text-navy-900 sm:text-[1.85rem]">
          {line1}
          <br />
          {line2}
        </h1>

        <div className="relative mt-4 flex w-full flex-1 items-center justify-center">
          <img
            src={brand.shopperProduct}
            alt={brand.productName}
            className="max-h-[min(48vh,360px)] w-full object-contain drop-shadow-[0_18px_28px_rgba(0,40,20,0.15)]"
          />
        </div>

        <Link to="/shopper/survey" className="mt-2 w-full shrink-0">
          <button
            type="button"
            className="w-full rounded-full bg-navy-900 py-3.5 text-[1.05rem] font-semibold text-gold-500 shadow-[0_10px_24px_rgba(0,77,38,0.28)] transition hover:bg-brand-600 active:scale-[0.99]"
          >
            Explore Now
          </button>
        </Link>

        <p className="mt-4 text-[11px] font-medium tracking-wide text-slate-600">
          No app required. 100% secure.
        </p>
      </div>
    </div>
  )
}

export function ShopperProductPage() {
  const { brand } = useBrand()

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-[#f7f4ec] px-4 pb-6 pt-5">
      <h2 className="text-center text-[1.35rem] font-bold tracking-tight text-slate-900 sm:text-xl">
        {brand.shopperDiscoveryTitle}
      </h2>

      <div className="flex flex-1 flex-col justify-center">
        <Link
          to="/shopper/spin"
          className="mt-5 block overflow-hidden rounded-2xl shadow-lg shadow-navy-900/20 ring-1 ring-black/10 transition hover:brightness-105 active:scale-[0.995]"
          aria-label="Play Now — Spin & Win"
        >
          <img
            src={brand.shopperPlayNow}
            alt="Play & Win — Exciting prizes for you! Play Now"
            className="h-auto w-full object-cover object-center"
          />
        </Link>
      </div>
    </div>
  )
}

export function ShopperLearnPage() {
  return (
    <div className="space-y-4 p-5">
      <div className="grid grid-cols-2 gap-3">
        {productCategories.map((c) => (
          <div key={c.title} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <div className="text-2xl">{c.emoji}</div>
            <div className="mt-2 text-sm font-semibold">{c.title}</div>
            <div className="mt-1 text-xs text-slate-500">{c.subtitle}</div>
          </div>
        ))}
      </div>
      <Link to="/shopper/spin">
        <Button className="w-full">Continue to Spin & Win</Button>
      </Link>
    </div>
  )
}

export function ShopperSpinPage() {
  const { brand } = useBrand()
  const spin = brand.shopperSpin
  const [spinning, setSpinning] = useState(false)
  const [won, setWon] = useState(false)

  const prizeIcons = [Percent, Gift, Ticket] as const

  function doSpin() {
    if (spinning || won) return
    setSpinning(true)
    setTimeout(() => {
      setSpinning(false)
      setWon(true)
    }, 2400)
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[radial-gradient(ellipse_at_center,#dc2626_0%,#991b1b_42%,#450a0a_100%)] px-5 pb-8 pt-6 text-center text-white">
      <div className="pointer-events-none absolute -right-16 -top-10 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(251,191,36,0.15),transparent_70%)]" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(220,38,38,0.35),transparent_70%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[40%] h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(251,191,36,0.28),transparent_65%)] blur-2xl" />

      {!won ? (
        <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col items-center">
          <img
            src={brand.logo}
            alt={brand.productName}
            className="h-11 w-auto object-contain drop-shadow-md"
          />

          <h1
            className="mt-3 font-display text-[2rem] font-black tracking-[0.04em] text-transparent sm:text-[2.15rem]"
            style={{
              backgroundImage: 'linear-gradient(180deg, #ffe566 0%, #f9b000 45%, #c98900 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
            }}
          >
            SPIN & WIN
          </h1>

          <div className="mt-1 flex w-44 items-center gap-2">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-500/80" />
            <span className="h-2 w-2 rotate-45 rounded-[2px] bg-gold-500" />
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-500/80" />
          </div>

          <p className="mt-2 text-sm font-medium text-white/90">{spin.subtitle}</p>

          <div className="mt-4 flex w-full items-stretch justify-between gap-1 rounded-2xl border border-gold-500/50 bg-navy-950/35 px-2.5 py-2.5 backdrop-blur-sm">
            {spin.prizeLabels.map((label, i) => {
              const Icon = prizeIcons[i]
              return (
                <div key={label} className="flex flex-1 flex-col items-center gap-1 px-0.5">
                  <Icon className="text-gold-400" size={16} />
                  <span className="text-[9px] leading-tight font-semibold text-gold-400">{label}</span>
                </div>
              )
            })}
          </div>

          <div className="relative mt-4 flex w-full flex-1 items-center justify-center">
            <div className="pointer-events-none absolute -left-6 top-8 h-40 w-16 rotate-[-18deg] rounded-full bg-[linear-gradient(180deg,rgba(255,201,51,0.55),rgba(249,176,0,0.05))] opacity-70 blur-[2px]" />
            <div className="pointer-events-none absolute -right-4 top-16 h-36 w-14 rotate-[22deg] rounded-full bg-[linear-gradient(180deg,rgba(255,201,51,0.5),rgba(249,176,0,0.05))] opacity-65 blur-[2px]" />

            <div className="relative h-[min(56vw,270px)] w-[min(56vw,270px)]">
              <div className="absolute -top-1 left-1/2 z-20 -translate-x-1/2">
                <div className="h-0 w-0 border-x-[11px] border-t-[20px] border-x-transparent border-t-gold-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]" />
              </div>

              <img
                src={spin.wheel}
                alt="Prize wheel"
                className={`h-full w-full object-contain mix-blend-lighten drop-shadow-[0_14px_32px_rgba(0,0,0,0.5)] ${
                  spinning ? 'animate-spin-wheel' : ''
                }`}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={doSpin}
            disabled={spinning}
            className="mt-auto flex w-full max-w-sm items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#ffe066] via-gold-500 to-[#d99800] py-3.5 text-base font-extrabold tracking-wide text-navy-900 shadow-[0_10px_24px_rgba(249,176,0,0.35)] transition enabled:hover:brightness-105 enabled:active:scale-[0.99] disabled:opacity-80"
          >
            <Leaf className="text-brand-700" size={16} />
            {spinning ? 'SPINNING...' : 'SPIN NOW'}
            <Leaf className="text-brand-700" size={16} />
          </button>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/75">
            <Lock size={12} className="text-gold-400" />
            100% Secure | Fair & Transparent
          </p>
        </div>
      ) : (
        <div className="animate-fade-up relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center">
          <img src={brand.logo} alt={brand.productName} className="mb-2 h-10 w-auto object-contain" />
          <div className="text-xs font-semibold tracking-[0.2em] text-gold-400 uppercase">You won</div>
          <div
            className="mt-2 text-5xl font-black tracking-tight text-transparent"
            style={{
              backgroundImage: 'linear-gradient(180deg, #ffe566 0%, #f9b000 50%, #c98900 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
            }}
          >
            {spin.winAmount}
          </div>
          <p className="mt-2 text-sm text-white/85">{spin.winDetail}</p>
          <div className="mt-6 w-full rounded-2xl border border-gold-500/40 bg-navy-950/40 p-4 backdrop-blur">
            <div className="text-xs text-gold-400/90">Promo code</div>
            <div className="mt-1 font-mono text-2xl font-bold tracking-widest text-white">
              {spin.promoCode}
            </div>
          </div>
          <Link to="/shopper/reward" className="mt-5 block w-full">
            <button
              type="button"
              className="w-full rounded-full bg-gradient-to-b from-[#ffe066] via-gold-500 to-[#d99800] py-3.5 text-base font-extrabold text-navy-900 shadow-[0_10px_24px_rgba(249,176,0,0.35)]"
            >
              Claim Reward
            </button>
          </Link>
        </div>
      )}
    </div>
  )
}

export function ShopperAiPage() {
  const [messages, setMessages] = useState<{ side: 'user' | 'bot'; text: string }[]>([
    {
      side: 'bot',
      text: "Hi! I'm here to help you learn about Tapal Tea. The Brand Ambassador stays in control — I just assist.",
    },
  ])
  const [input, setInput] = useState('')

  function send(text: string) {
    const q = text.trim()
    if (!q) return
    setMessages((m) => [
      ...m,
      { side: 'user', text: q },
      {
        side: 'bot',
        text: 'Tapal Tea is Pakistan\'s favourite tea — a rich, aromatic cup for everyday moments and sharing with family.',
      },
    ])
    setInput('')
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex-1 space-y-3 overflow-auto p-3 sm:p-4">
        {messages.map((m, i) => (
          <Bubble key={i} side={m.side}>
            {m.text}
          </Bubble>
        ))}
        {messages.length < 3 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {['Is it healthy?', 'Best for doodh patti?', "What's the price?", 'Which pack?'].map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 p-3">
        <div className="mb-2 flex min-w-0 gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none"
            placeholder="Ask something..."
          />
          <Button className="shrink-0" onClick={() => send(input)}>Send</Button>
        </div>
        <Link to="/shopper/survey" className="block text-center text-xs font-semibold text-brand-600">
          Continue to consumer questions →
        </Link>
      </div>
    </div>
  )
}

function Bubble({ children, side }: { children: ReactNode; side: 'user' | 'bot' }) {
  const isUser = side === 'user'
  return (
    <div
      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
        isUser
          ? 'ml-auto rounded-br-sm bg-brand-500 text-white'
          : 'mr-auto rounded-bl-sm bg-slate-100 text-slate-800'
      }`}
    >
      {children}
    </div>
  )
}

const SURVEY_STEPS = 3
const genderOptions = ['Male', 'Female']

export function ShopperSurveyPage() {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState<string | null>(null)
  const [age, setAge] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [consent, setConsent] = useState(true)

  const profileReady = name.trim() !== '' && phone.trim() !== '' && gender != null && age.trim() !== ''
  const canContinue =
    step === 1 ? profileReady : step === 2 ? selected != null : reasons.length > 0 && consent

  function toggleReason(opt: string) {
    setReasons((current) => (current.includes(opt) ? current.filter((item) => item !== opt) : [...current, opt]))
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col p-4 sm:p-5">
      <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Question {step} of {SURVEY_STEPS}
      </div>

      {step === 1 && (
        <>
          <h2 className="text-xl font-bold">Enter your details</h2>
          <div className="mt-6 space-y-3">
            <SurveyField label="Name" value={name} onChange={setName} placeholder="Your name" />
            <SurveyField
              label="Number"
              value={phone}
              onChange={setPhone}
              placeholder="03xx xxxxxxx"
              inputMode="tel"
            />
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-500">Gender</div>
              <div className="grid grid-cols-2 gap-3">
                {genderOptions.map((opt) => (
                  <SurveyChoice key={opt} label={opt} selected={gender === opt} onSelect={() => setGender(opt)} />
                ))}
              </div>
            </div>
            <SurveyField label="Age" value={age} onChange={setAge} placeholder="Age" inputMode="numeric" />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="text-xl font-bold">Which tea do you currently use?</h2>
          <p className="mt-2 text-sm text-slate-500">
            Captures preferred tea brand, pack size, cups per day, frequency, price sensitivity & more.
          </p>
          <div className="mt-6 space-y-3">
            {surveyOptions.map((opt) => (
              <SurveyChoice key={opt} label={opt} selected={selected === opt} onSelect={() => setSelected(opt)} />
            ))}
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="text-xl font-bold">Reason for selection</h2>
          <p className="mt-2 text-sm text-slate-500">Why did you choose this tea? Select all that apply.</p>
          <div className="mt-6 space-y-3">
            {selectionReasons.map((opt) => (
              <SurveyChoice
                key={opt}
                label={opt}
                multiple
                selected={reasons.includes(opt)}
                onSelect={() => toggleReason(opt)}
              />
            ))}
          </div>
          <label className="mt-6 flex items-start gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to store my preference data for campaign insights (CRM sync).
          </label>
        </>
      )}

      <div className="mt-auto pt-8">
        <div className="mb-4 flex justify-center gap-2">
          {Array.from({ length: SURVEY_STEPS }, (_, i) => i + 1).map((n) => (
            <span key={n} className={`h-2 w-2 rounded-full ${n <= step ? 'bg-brand-500' : 'bg-slate-200'}`} />
          ))}
        </div>
        {step < SURVEY_STEPS ? (
          <Button className="w-full" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
            Continue
          </Button>
        ) : (
          <Link to={canContinue ? '/shopper/product' : '#'}>
            <Button className="w-full" disabled={!canContinue}>
              Continue
            </Button>
          </Link>
        )}
      </div>
    </div>
  )
}

function SurveyField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  inputMode?: 'tel' | 'numeric'
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(inputMode === 'numeric' ? e.target.value.replace(/\D/g, '') : e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        placeholder={placeholder}
      />
    </label>
  )
}

function SurveyChoice({
  label,
  selected,
  onSelect,
  multiple = false,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  multiple?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-sm font-medium ${
        selected ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
          multiple ? 'rounded' : 'rounded-full'
        } ${selected ? (multiple ? 'border-brand-500 bg-brand-500' : 'border-brand-500') : 'border-slate-300'}`}
      >
        {selected &&
          (multiple ? (
            <Check className="text-white" size={12} strokeWidth={3} />
          ) : (
            <span className="h-2 w-2 rounded-full bg-brand-500" />
          ))}
      </span>
      {label}
    </button>
  )
}

export function ShopperRewardPage() {
  const { brand } = useBrand()
  const spin = brand.shopperSpin

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center bg-white px-6 py-10 text-center">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
        <rect x="10" y="22" width="36" height="26" rx="3" fill="#F9B000" stroke="#1a1a1a" strokeWidth="2" />
        <rect x="8" y="14" width="40" height="10" rx="2" fill="#FFC933" stroke="#1a1a1a" strokeWidth="2" />
        <rect x="25" y="14" width="6" height="34" fill="#E11D48" stroke="#1a1a1a" strokeWidth="1.5" />
        <path
          d="M28 14c-4-6-10-6-10 0 0 4 6 6 10 8 4-2 10-4 10-8 0-6-6-6-10 0Z"
          fill="#E11D48"
          stroke="#1a1a1a"
          strokeWidth="1.5"
        />
      </svg>

      <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Reward unlocked</h2>
      <p className="mt-2 max-w-xs text-sm text-slate-500">
        Show this to your Brand Ambassador at checkout.
      </p>

      <div className="mt-7 w-full max-w-sm rounded-2xl border border-amber-200/90 bg-[#fff8eb] px-5 py-6 shadow-sm">
        <div className="text-[11px] font-bold tracking-[0.14em] text-amber-600 uppercase">Voucher</div>
        <div className="mt-1.5 text-3xl font-black tracking-wide text-navy-900">{spin.promoCode}</div>
        <div className="mt-1.5 text-sm text-slate-600">
          {spin.winAmount} · {spin.winDetail}
        </div>
      </div>

      <Link to="/shopper/feedback" className="mt-8 w-full max-w-sm">
        <button
          type="button"
          className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600 active:scale-[0.99]"
        >
          Share your experience
        </button>
      </Link>
    </div>
  )
}

export function ShopperFeedbackPage() {
  const demo = useDemo()
  const navigate = useNavigate()
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')

  const labels = ['Poor', 'Fair', 'Good', 'Great', 'Excellent']

  function finish() {
    if (rating == null) return
    demo.completeShopperSession()
    navigate('/shopper/thanks', { state: { rating, label: labels[rating - 1] } })
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-[#f7f4ec]">
      <div className="flex flex-1 flex-col px-5 pb-6 pt-6">
        <div className="mx-auto w-full max-w-sm flex-1">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 shadow-md shadow-navy-900/20">
              <Sparkles className="text-gold-400" size={22} />
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
              How was your experience?
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Tell us about your visit — it helps improve the in-store experience.
            </p>
          </div>

          <div className="mt-8 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <div className="text-center text-[11px] font-semibold tracking-[0.16em] text-brand-600 uppercase">
              Rate your visit
            </div>
            <div className="mt-4 grid grid-cols-5 gap-1.5 sm:gap-2">
              {[1, 2, 3, 4, 5].map((n) => {
                const active = rating === n
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className={`flex flex-col items-center rounded-2xl border py-3 transition active:scale-[0.97] ${
                      active
                        ? 'border-navy-900 bg-navy-900 text-white shadow-md shadow-navy-900/25'
                        : 'border-slate-200 bg-[#f7f4ec] text-slate-800 hover:border-brand-400'
                    }`}
                  >
                    <span className="text-lg font-bold">{n}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-center text-xs font-medium text-slate-500">
              {rating != null ? labels[rating - 1] : 'Tap a score from 1–5'}
            </p>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-5 min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-[#f7f4ec]/70 px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
              placeholder="Optional comment..."
            />
          </div>
        </div>

        <button
          type="button"
          onClick={finish}
          disabled={rating == null}
          className="mx-auto mt-6 w-full max-w-sm rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Submit feedback
        </button>
      </div>
    </div>
  )
}

export function ShopperThanksPage() {
  const demo = useDemo()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { rating?: number; label?: string } }
  const rating = location.state?.rating
  const label = location.state?.label

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#f7f4ec] px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-navy-900 shadow-lg shadow-navy-900/25">
        <Sparkles className="text-gold-400" size={28} />
      </div>
      <h2 className="mt-5 text-2xl font-bold text-slate-900">Thank you!</h2>
      <p className="mt-2 max-w-xs text-sm text-slate-500">
        Your feedback was received. Enjoy your reward and thank you for choosing Tapal Tea.
      </p>
      {rating != null && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-[#fff8eb] px-5 py-3 text-sm font-semibold text-navy-900">
          You rated {rating}/5{label ? ` · ${label}` : ''}
        </div>
      )}
      <button
        type="button"
        onClick={() => navigate('/shopper')}
        className="mt-8 w-full max-w-sm rounded-2xl bg-navy-900 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition hover:bg-brand-600"
      >
        Done
      </button>
      <button
        type="button"
        className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-600"
        onClick={() => {
          demo.resetDemo()
          navigate('/shopper')
        }}
      >
        Start again
      </button>
    </div>
  )
}
