import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button, Card, CardHeader, Modal } from '../../components/ui'
import { formatPkr } from '../../lib/incentives'
import { DEFAULT_KPI_CONFIG, setKpiConfig, useKpiConfig, type KpiConfig } from '../../lib/kpiConfig'

type Draft = Record<keyof KpiConfig, string>

const toDraft = (c: KpiConfig): Draft =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) as Draft

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500'

const num = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))
const rs = (n: number) => formatPkr(Math.round(n * 100) / 100)

/** Every setting, with what it is called in an error message and whether 0 is allowed. */
const FIELDS: { key: keyof KpiConfig; label: string; positive?: boolean }[] = [
  { key: 'basePay', label: 'Ambassador base pay' },
  { key: 'conversionTarget', label: 'Ambassador conversion rate', positive: true },
  { key: 'conversionAmount', label: 'Ambassador conversion incentive' },
  { key: 'sessionTarget', label: 'Ambassador sessions', positive: true },
  { key: 'sessionAmount', label: 'Ambassador session incentive' },
  { key: 'supBasePay', label: 'Supervisor base pay' },
  { key: 'supConversionTarget', label: 'Supervisor team conversion', positive: true },
  { key: 'supConversionAmount', label: 'Supervisor conversion incentive' },
  { key: 'supCoverageTarget', label: 'Supervisor store coverage', positive: true },
  { key: 'supCoverageAmount', label: 'Supervisor coverage incentive' },
]

function NumberInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  suffix?: string
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <div className="relative">
        <input
          type="number"
          min={0}
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} ${suffix ? 'pr-16' : ''}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

/** "When <target> is reached, pay Rs <amount>" — with what that works out to per unit. */
function KpiGroup({
  title,
  targetLabel,
  targetSuffix,
  unit,
  draft,
  targetKey,
  amountKey,
  set,
}: {
  title: string
  targetLabel: string
  targetSuffix: string
  unit: string
  draft: Draft
  targetKey: keyof Draft
  amountKey: keyof Draft
  set: (key: keyof Draft) => (v: string) => void
}) {
  const target = num(draft[targetKey])
  const amount = num(draft[amountKey])
  const ok = target > 0 && Number.isFinite(amount)
  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 p-3">
      <div className="font-semibold text-slate-900">{title}</div>
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label={targetLabel} value={draft[targetKey]} onChange={set(targetKey)} suffix={targetSuffix} />
        <NumberInput label="Incentive (Rs.)" value={draft[amountKey]} onChange={set(amountKey)} />
      </div>
      {ok && (
        <p className="text-xs text-slate-500">
          = {rs(amount / target)} per {unit}. At half the target, {rs(amount / 2)}.
        </p>
      )}
    </div>
  )
}

/** Dialog where Head Office sets the KPIs used to calculate every incentive. */
export function KpiSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useKpiConfig()
  const [draft, setDraft] = useState<Draft>(() => toDraft(config))
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(false)

  // Start from the saved values each time the dialog opens
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(toDraft(config))
      setError(null)
    }
  }

  const set = (key: keyof Draft) => (v: string) => setDraft({ ...draft, [key]: v })

  function save() {
    const next = { ...DEFAULT_KPI_CONFIG }
    for (const f of FIELDS) {
      const value = num(draft[f.key])
      if (!Number.isFinite(value) || value < 0 || (f.positive && value === 0)) {
        setError(`${f.label} must be a number${f.positive ? ' greater than 0' : ' of 0 or more'}.`)
        return
      }
      next[f.key] = value
    }
    setKpiConfig(next)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Set KPIs">
      <div className="space-y-4 text-sm">
        <p className="text-xs text-slate-500">
          Set what each KPI is worth. Pay is proportional: half the target pays half the incentive. Saving
          recalculates everyone straight away.
        </p>

        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Ambassadors</div>
        <NumberInput label="Base pay (Rs.)" value={draft.basePay} onChange={set('basePay')} />
        <KpiGroup
          title="Conversion rate"
          targetLabel="When conversion rate is"
          targetSuffix="%"
          unit="1% of conversion"
          draft={draft}
          targetKey="conversionTarget"
          amountKey="conversionAmount"
          set={set}
        />
        <KpiGroup
          title="Sessions"
          targetLabel="When a BA completes"
          targetSuffix="sessions"
          unit="session"
          draft={draft}
          targetKey="sessionTarget"
          amountKey="sessionAmount"
          set={set}
        />

        <div className="border-t border-slate-100 pt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Supervisors
        </div>
        <NumberInput label="Base pay (Rs.)" value={draft.supBasePay} onChange={set('supBasePay')} />
        <KpiGroup
          title="Team conversion (average of their BAs)"
          targetLabel="When team conversion is"
          targetSuffix="%"
          unit="1% of team conversion"
          draft={draft}
          targetKey="supConversionTarget"
          amountKey="supConversionAmount"
          set={set}
        />
        <KpiGroup
          title="Store coverage (average of their stores)"
          targetLabel="When store coverage is"
          targetSuffix="%"
          unit="1% of coverage"
          draft={draft}
          targetKey="supCoverageTarget"
          amountKey="supCoverageAmount"
          set={set}
        />

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
        )}

        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          <Button onClick={save}>Save KPIs</Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Dashboard entry point: current KPIs at a glance and the button that opens the dialog. */
export function IncentiveKpiCard() {
  const config = useKpiConfig()
  const [open, setOpen] = useState(false)
  const chip = 'rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600'

  return (
    <Card>
      <CardHeader
        title="Incentive KPIs"
        subtitle="Incentives are calculated automatically from these KPIs"
        action={
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <SlidersHorizontal size={13} /> Set KPIs
          </Button>
        }
      />
      <div className="space-y-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 font-semibold text-slate-500 uppercase">Ambassadors</span>
          <span className={chip}>Base pay {formatPkr(config.basePay)}</span>
          <span className={chip}>
            Conversion {config.conversionTarget}% → {formatPkr(config.conversionAmount)}
          </span>
          <span className={chip}>
            Sessions {config.sessionTarget} → {formatPkr(config.sessionAmount)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 font-semibold text-slate-500 uppercase">Supervisors</span>
          <span className={chip}>Base pay {formatPkr(config.supBasePay)}</span>
          <span className={chip}>
            Team conversion {config.supConversionTarget}% → {formatPkr(config.supConversionAmount)}
          </span>
          <span className={chip}>
            Coverage {config.supCoverageTarget}% → {formatPkr(config.supCoverageAmount)}
          </span>
        </div>
      </div>
      <KpiSettingsModal open={open} onClose={() => setOpen(false)} />
    </Card>
  )
}
