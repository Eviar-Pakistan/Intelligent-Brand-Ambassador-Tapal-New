import { ProgressRing, StatusBadge } from '../../components/ui'
import { PASS_MARK, type AssessmentResult } from '../../lib/baAssessment'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3.5 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{value}</div>
    </div>
  )
}

/** Results of a BA's verbal assessment. Shown to the BA after they finish and to Head Office. */
export function AssessmentReport({
  name,
  result,
}: {
  name: string
  result: AssessmentResult
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Tapal · {name}</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Assessment report</h1>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={result.certified ? 'Certified' : 'Rejected'} />
          {!result.certified && (
            <span className="text-xs text-slate-500">Needs {result.passMark ?? PASS_MARK}% quality to be certified</span>
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="flex justify-center">
          <ProgressRing
            value={result.quality}
            size={132}
            stroke={12}
            color={result.certified ? '#047857' : '#dc2626'}
            label="Quality"
          />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <Metric label="Communication" value={`${result.communication}/100`} />
          <Metric label="Question relevance" value={`${result.relevance}%`} />
          <Metric label="Training alignment" value={`${result.alignment}%`} />
          <Metric label="WPM" value={String(result.wpm)} />
          <Metric label="Nervousness" value={`${result.nervousness}%`} />
          <Metric label="Mood" value={result.mood} />
        </div>
      </section>
    </div>
  )
}
