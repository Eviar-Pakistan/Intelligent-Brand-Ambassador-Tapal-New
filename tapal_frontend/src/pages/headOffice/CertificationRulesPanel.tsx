import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import { fetchPlatformSettings, updatePlatformSettings } from '../../lib/platformSettings'

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500'

/** The score that certifies or rejects a BA after the NLP analyzer scores their answers. */
export function CertificationRulesPanel() {
  const [passThreshold, setPassThreshold] = useState('75')
  const [aPlusThreshold, setAPlusThreshold] = useState('90')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchPlatformSettings()
        if (cancelled) return
        setPassThreshold(String(data.certification_threshold))
        setAPlusThreshold(String(data.a_plus_threshold))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the certification score.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    const pass = Number(passThreshold)
    const aPlus = Number(aPlusThreshold)
    if (!Number.isFinite(pass) || pass < 1 || pass > 100) {
      setError('Certification score must be a number from 1 to 100.')
      return
    }
    if (!Number.isFinite(aPlus) || aPlus < 1 || aPlus > 100) {
      setError('A+ score must be a number from 1 to 100.')
      return
    }
    if (aPlus < pass) {
      setError('A+ score must be greater than or equal to the certification score.')
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await updatePlatformSettings({
        certification_threshold: Math.round(pass),
        a_plus_threshold: Math.round(aPlus),
      })
      setPassThreshold(String(saved.certification_threshold))
      setAPlusThreshold(String(saved.a_plus_threshold))
      setMessage(
        `Saved. A score of ${saved.certification_threshold} or higher certifies the BA. Below that, they are rejected.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the certification score.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading certification score…</p>

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Certification score</span>
        <input
          type="number"
          min={1}
          max={100}
          value={passThreshold}
          onChange={(e) => setPassThreshold(e.target.value)}
          className={fieldClass}
        />
        <span className="mt-1 block text-xs text-slate-500">
          The NLP analyzer scores each answer from the video transcript. At or above this score, the BA is
          certified. Below it, they are rejected.
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">A+ score</span>
        <input
          type="number"
          min={1}
          max={100}
          value={aPlusThreshold}
          onChange={(e) => setAPlusThreshold(e.target.value)}
          className={fieldClass}
        />
        <span className="mt-1 block text-xs text-slate-500">Must be at least the certification score.</span>
      </label>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}
      <Button disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save certification score'}
      </Button>
    </div>
  )
}
