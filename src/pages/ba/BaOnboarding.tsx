import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrainingContent, type TrainingModule } from '../../context/TrainingContentContext'
import { MIN_ANSWER_SECONDS } from '../../lib/baAssessment'
import {
  baTrainingVideoUrl,
  createBaSession,
  engineSessionKey,
  finishBaSession,
  getBaSession,
  metricsFromEngine,
  resultFromEngine,
  uploadBaAnswer,
} from '../../lib/trainingApi'
import { updateBaAccount, type BaAccount } from '../../lib/baAccounts'
import { AssessmentReport } from './AssessmentReport'

const primaryButton =
  'rounded-2xl bg-navy-900 px-5 py-3.5 text-base font-semibold text-white shadow-md shadow-navy-900/20 transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-45'
const secondaryButton =
  'rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50'

function StepCard({ step, title, children }: { step: string; title: string; children?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{step}</div>
      <h1 className="mt-1 text-2xl leading-snug font-bold text-slate-900">{title}</h1>
      {children}
    </section>
  )
}

/** A newly created BA: watch the training video, answer the verbal assessment, get the report. */
export function BaOnboarding({ account }: { account: BaAccount }) {
  const { modules } = useTrainingContent()
  const module = modules.find((m) => m.videoUrl) ?? modules[0]

  if (account.result) return <ResultStep account={account} />
  if (!account.videoWatched) return <VideoStep account={account} module={module} />
  return <AssessmentStep account={account} />
}

// ─── Step 1: training video ──────────────────────────────────────────────────

function VideoStep({ account, module }: { account: BaAccount; module: TrainingModule | undefined }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const furthest = useRef(0)
  const [percent, setPercent] = useState(0)
  const [finished, setFinished] = useState(false)
  const [serverVideoFailed, setServerVideoFailed] = useState(false)
  const videoSrc = !serverVideoFailed ? baTrainingVideoUrl() : module?.videoUrl

  function onTimeUpdate() {
    const v = videoRef.current
    if (!v || !v.duration) return
    // only natural playback counts as watched, not a jump forward
    if (!v.seeking && v.currentTime > furthest.current && v.currentTime - furthest.current < 2) {
      furthest.current = v.currentTime
    }
    const pct = Math.min(100, (furthest.current / v.duration) * 100)
    setPercent(Math.floor(pct))
    if (pct >= 98) setFinished(true)
  }

  function onSeeking() {
    const v = videoRef.current
    if (v && v.currentTime > furthest.current + 0.5) v.currentTime = furthest.current
  }

  return (
    <div className="space-y-4 py-4">
      <StepCard step="Step 1 · Training" title="Watch the BA training video">
        <p className="mt-2 text-base text-slate-500">
          Hi {account.name}. Watch the full video, then continue to the verbal assessment.
        </p>
      </StepCard>

      {videoSrc ? (
        <video
          key={videoSrc}
          ref={videoRef}
          src={videoSrc}
          controls
          controlsList="nodownload noplaybackrate"
          playsInline
          onError={() => {
            if (!serverVideoFailed) setServerVideoFailed(true)
          }}
          onTimeUpdate={onTimeUpdate}
          onSeeking={onSeeking}
          onEnded={() => {
            setFinished(true)
            setPercent(100)
          }}
          className="w-full rounded-2xl bg-black shadow-sm"
        />
      ) : (
        <div className="rounded-2xl bg-slate-200/80 px-4 py-10 text-center text-sm text-slate-600">
          No training video has been published yet. Ask Head Office to upload one under Ambassadors → Training
          videos, then reload this page.
        </div>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="text-sm text-slate-600">Watched {percent}%</div>
        <button
          type="button"
          disabled={!finished}
          onClick={() => updateBaAccount(account.id, { videoWatched: true, status: 'Training' })}
          className={`mt-3 w-full ${primaryButton}`}
        >
          {finished ? 'Continue to assessment' : 'Finish the video first'}
        </button>
      </section>
    </div>
  )
}

// ─── Step 2: verbal assessment ───────────────────────────────────────────────

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
type BrowserWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
  webkitAudioContext?: typeof AudioContext
}

type Phase = 'idle' | 'recording'

type Capture = {
  stream: MediaStream | null
  recorder: MediaRecorder | null
  audioRecorder: MediaRecorder | null
  audioChunks: Blob[]
  recognition: SpeechRecognitionLike | null
  audioCtx: AudioContext | null
  timer: number | null
  active: boolean
  startedAt: number
  speechFrames: number
  transcript: string
  durationSec: number
  speechSec: number
}

const SAMPLE_MS = 200

function AssessmentStep({ account }: { account: BaAccount }) {
  const [engineQuestions, setEngineQuestions] = useState<{ id: string; prompt: string; description: string }[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(true)
  const [scoring, setScoring] = useState(false)
  const questions = engineQuestions
  const qIndex = account.answers.length
  const question = questions[qIndex]

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const capture = useRef<Capture>({
    stream: null,
    recorder: null,
    audioRecorder: null,
    audioChunks: [],
    recognition: null,
    audioCtx: null,
    timer: null,
    active: false,
    startedAt: 0,
    speechFrames: 0,
    transcript: '',
    durationSec: 0,
    speechSec: 0,
  })

  useEffect(() => {
    let cancelled = false
    const token = account.accessToken
    function keepMatching(ids: string[]) {
      const allowed = new Set(ids)
      const kept = account.answers.filter((answer) => allowed.has(answer.questionId))
      if (kept.length !== account.answers.length) {
        updateBaAccount(account.id, { answers: kept, result: null })
      }
    }
    async function openSession() {
      try {
        const saved = sessionStorage.getItem(engineSessionKey(token))
        if (saved) {
          try {
            const existing = await getBaSession(saved)
            if (!cancelled && existing.status !== 'completed' && existing.questions?.length) {
              setSessionId(existing.sessionId)
              setEngineQuestions(
                existing.questions.map((item) => ({
                  id: item.id,
                  prompt: item.question,
                  description: item.description || '',
                })),
              )
              keepMatching(existing.questions.map((item) => item.id))
              setPreparing(false)
              return
            }
          } catch {
            sessionStorage.removeItem(engineSessionKey(token))
          }
        }
        const created = await createBaSession(token)
        if (cancelled) return
        sessionStorage.setItem(engineSessionKey(token), created.sessionId)
        setSessionId(created.sessionId)
        setEngineQuestions(
          created.questions.map((item) => ({
            id: item.id,
            prompt: item.question,
            description: item.description || '',
          })),
        )
        keepMatching(created.questions.map((item) => item.id))
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not start assessment')
        }
      } finally {
        if (!cancelled) setPreparing(false)
      }
    }
    void openSession()
    return () => {
      cancelled = true
    }
  }, [account.accessToken])

  function release() {
    const c = capture.current
    c.active = false
    if (c.timer !== null) window.clearInterval(c.timer)
    c.timer = null
    try {
      c.recognition?.stop()
    } catch {
      // already stopped
    }
    if (c.recorder && c.recorder.state !== 'inactive') c.recorder.stop()
    if (c.audioRecorder && c.audioRecorder.state !== 'inactive') c.audioRecorder.stop()
    c.stream?.getTracks().forEach((t) => t.stop())
    c.audioCtx?.close().catch(() => {})
    c.stream = null
    c.audioCtx = null
  }

  // stop the camera and microphone if the BA leaves the page mid-recording
  useEffect(() => release, [])

  // the live preview element only exists while not reviewing a take, so attach the stream here
  useEffect(() => {
    const v = previewRef.current
    if (phase !== 'recording' || !v || !capture.current.stream) return
    v.srcObject = capture.current.stream
    v.play().catch(() => {})
  }, [phase])

  async function start() {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera. Open this page in Chrome or Edge.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
    } catch {
      setError('Camera and microphone access is needed for the assessment. Allow access in your browser and try again.')
      return
    }

    const c = capture.current
    Object.assign(c, {
      stream,
      active: true,
      startedAt: Date.now(),
      speechFrames: 0,
      transcript: '',
      durationSec: 0,
      speechSec: 0,
      audioChunks: [],
      audioRecorder: null,
    })

    // keep a copy of the video so the BA can play it back before submitting
    if (typeof MediaRecorder !== 'undefined') {
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
      recorder.onstop = () => {
        if (chunks.length) setPlaybackUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })))
      }
      recorder.start()
      c.recorder = recorder
    }

    if (typeof MediaRecorder !== 'undefined' && stream.getAudioTracks().length) {
      const audioStream = new MediaStream(stream.getAudioTracks())
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const audioRecorder = mime ? new MediaRecorder(audioStream, { mimeType: mime }) : new MediaRecorder(audioStream)
      c.audioChunks = []
      audioRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) c.audioChunks.push(e.data)
      }
      audioRecorder.onstop = () => {
        c.audioRecorder = null
      }
      audioRecorder.start()
      c.audioRecorder = audioRecorder
    }

    // measure how much of the time the BA is actually speaking
    const w = window as BrowserWindow
    let analyser: AnalyserNode | null = null
    try {
      const Ctx = window.AudioContext ?? w.webkitAudioContext
      if (Ctx && stream.getAudioTracks().length) {
        c.audioCtx = new Ctx()
        analyser = c.audioCtx.createAnalyser()
        analyser.fftSize = 1024
        c.audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser)
      }
    } catch {
      analyser = null
    }
    const samples = new Uint8Array(analyser?.fftSize ?? 0)

    // speech-to-text where the browser supports it (Chrome, Edge)
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (Recognition) {
      const recognition = new Recognition()
      recognition.continuous = true
      recognition.interimResults = false
      recognition.lang = 'en-IN'
      recognition.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          if (e.results[i].isFinal) c.transcript += ` ${e.results[i][0].transcript}`
        }
      }
      recognition.onend = () => {
        if (!c.active) return
        try {
          recognition.start()
        } catch {
          // browser refused to restart — keep what we have
        }
      }
      recognition.onerror = () => {}
      try {
        recognition.start()
        c.recognition = recognition
      } catch {
        c.recognition = null
      }
    }

    c.timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - c.startedAt) / 1000))
      if (!analyser) return
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += ((s - 128) / 128) ** 2
      if (Math.sqrt(sum / samples.length) > 0.02) c.speechFrames += 1
    }, SAMPLE_MS)

    setElapsed(0)
    setPhase('recording')
  }

  function takeAudio() {
    const c = capture.current
    c.durationSec = (Date.now() - c.startedAt) / 1000
    c.speechSec = (c.speechFrames * SAMPLE_MS) / 1000
    const recorder = c.audioRecorder
    return new Promise<Blob>((resolve) => {
      const finish = () => resolve(new Blob(c.audioChunks, { type: 'audio/webm' }))
      if (!recorder || recorder.state === 'inactive') {
        release()
        finish()
        return
      }
      recorder.addEventListener('stop', finish, { once: true })
      release()
    })
  }

  async function stop() {
    if (scoring) return
    setScoring(true)
    setError(null)
    const audio = await takeAudio()
    if (previewRef.current) previewRef.current.srcObject = null
    setPhase('idle')
    await submit(audio)
  }

  async function submit(audio: Blob) {
    const c = capture.current
    if (!sessionId || !question) {
      setScoring(false)
      return
    }
    if (c.durationSec < MIN_ANSWER_SECONDS) {
      setScoring(false)
      setError(`Your answer was too short. Record again and speak for at least ${MIN_ANSWER_SECONDS} seconds.`)
      return
    }
    if (!audio.size) {
      setScoring(false)
      setError('The recording had no audio. Record again and speak into the microphone.')
      return
    }
    try {
      const scored = await uploadBaAnswer(sessionId, question.id, audio)
      const metrics = metricsFromEngine(scored.answer, c.durationSec)
      const answers = [...account.answers, metrics]
      if (answers.length >= questions.length) {
        const report = await finishBaSession(sessionId)
        sessionStorage.removeItem(engineSessionKey(account.accessToken))
        updateBaAccount(account.id, {
          answers,
          result: resultFromEngine(report),
          status: report.certified ? 'Certified' : 'Training',
        })
      } else {
        updateBaAccount(account.id, { answers })
      }
      setElapsed(0)
      setPhase('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The NLP analyzer could not score this answer.')
    } finally {
      setScoring(false)
    }
  }

  if (preparing) {
    return (
      <div className="py-4">
        <StepCard step="Step 2 · Assessment" title="Preparing your assessment">
          <p className="mt-2 text-sm text-slate-500">Connecting to the NLP analyzer…</p>
        </StepCard>
      </div>
    )
  }

  if (!sessionId || questions.length === 0 || !question) {
    return (
      <div className="py-4">
        <StepCard step="Step 2 · Assessment" title="No assessment questions yet">
          <p className="mt-2 text-sm text-slate-500">
            {error ||
              'Head Office has not added a training video with assessment questions. Ask them to upload one under Ambassadors → Training videos, then reload this page.'}
          </p>
        </StepCard>
      </div>
    )
  }

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="space-y-4 py-4">
      <StepCard
        step={`Step 2 · Assessment · Question ${qIndex + 1} of ${questions.length}`}
        title={question.prompt}
      >
        {question.description ? (
          <p className="mt-2 text-base text-slate-600">{question.description}</p>
        ) : null}
        <p className="mt-2 text-sm text-slate-500">
          Answer out loud from what you learned in the training video. Your answer is scored against the video
          transcript.
        </p>
      </StepCard>

      {phase === 'recording' && (
      <div className="relative overflow-hidden rounded-2xl bg-navy-950">
        <video
          ref={previewRef}
          muted
          playsInline
          autoPlay
          className="aspect-[4/3] w-full -scale-x-100 bg-slate-900 object-cover"
        />
        <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          REC {clock}
        </div>
      </div>
      )}

      <div className="flex flex-wrap gap-3">
        {scoring ? (
          <button type="button" disabled className={primaryButton}>
            Analyzing…
          </button>
        ) : phase === 'recording' ? (
          <button type="button" onClick={() => void stop()} className={secondaryButton}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            className="rounded-2xl bg-brand-500 px-5 py-3.5 text-base font-semibold text-white shadow-md shadow-brand-500/25 transition hover:bg-brand-600"
          >
            Start recording
          </button>
        )}
      </div>

      {phase === 'idle' && !scoring && (
        <p className="text-sm text-slate-500">
          Press Start recording and answer out loud. When you stop, the answer is scored and the analysis is shown.
        </p>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}
    </div>
  )
}

// ─── Step 3: results ─────────────────────────────────────────────────────────

function ResultStep({ account }: { account: BaAccount }) {
  const navigate = useNavigate()
  if (!account.result) return null

  return (
    <div className="space-y-4 py-4">
      <AssessmentReport name={account.name} result={account.result} />
      {account.result.certified ? (
        <button type="button" onClick={() => navigate('/ba/home')} className={`w-full ${primaryButton}`}>
          Go to Home
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(engineSessionKey(account.accessToken))
            updateBaAccount(account.id, { answers: [], result: null, videoWatched: false, status: 'Training' })
          }}
          className={`w-full ${primaryButton}`}
        >
          Retake assessment
        </button>
      )}
    </div>
  )
}
