import { djangoFetch } from './djangoApi'
import type { AnswerMetrics, AssessmentResult, MoodLabel } from './baAssessment'

export type TrainingQuestion = {
  id: string
  type: string
  question: string
  description: string
}

type EngineAnswer = {
  question_id: string
  question_title: string
  transcript?: string
  communication_quality?: number
  speaking_speed_wpm?: number
  nervousness_pct?: number
  dominant_mood?: string
  question_relevance?: { relevance_pct?: number }
  video_relevance?: { relevance_pct?: number }
}

type EngineQuestionScore = {
  question_id?: string
  question_title?: string
  transcript?: string
  communication_quality?: number
  speaking_speed_wpm?: number
  nervousness_pct?: number
  dominant_mood?: string
  relevance_pct?: number
  video_relevance_pct?: number
}

export type EngineReport = {
  certified?: boolean
  communication_quality?: number
  relevance_pct?: number
  video_relevance_pct?: number
  speaking_speed_wpm?: number
  nervousness_pct?: number
  dominant_mood?: string
  certification_threshold?: number
  ambassador_status?: string
  answer_count?: number
  per_question?: EngineQuestionScore[]
}

export type SavedTrainingVideo = {
  id: number
  original_name: string
  is_active: boolean
  ready: boolean
  question_count: number
  questions: TrainingQuestion[]
  transcript_preview: string
  created_at: string
}

export function baTrainingVideoUrl() {
  return '/api/ba/training/video/'
}

export function engineSessionKey(token: string) {
  return `ba-engine-session:${token}`
}

async function parseError(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as { detail?: string; error?: string }
    return data.detail || data.error || fallback
  } catch {
    return fallback
  }
}

export async function retranscribeTrainingVideo(id: number) {
  const res = await djangoFetch(`/api/training-videos/${id}/retranscribe/`, { method: 'POST' })
  if (!res.ok) throw new Error(await parseError(res, 'Could not transcribe this video.'))
  return res.json() as Promise<{ video?: SavedTrainingVideo }>
}

export async function listTrainingVideos() {
  const res = await djangoFetch('/api/training-videos/')
  if (!res.ok) throw new Error(await parseError(res, 'Could not load training videos.'))
  const data = (await res.json()) as SavedTrainingVideo[] | { results: SavedTrainingVideo[] }
  return Array.isArray(data) ? data : data.results ?? []
}

/** Head Office upload. The NLP analyzer scores BA answers against this video. */
export async function uploadTrainingVideo(
  file: File,
  prompts: { question: string; description?: string }[],
) {
  const questions = prompts
    .map((item) => ({ question: item.question.trim(), description: (item.description ?? '').trim() }))
    .filter((item) => item.question)
  if (!questions.length) throw new Error('Add at least one assessment question before uploading.')
  const form = new FormData()
  form.append('file', file)
  form.append(
    'questions',
    JSON.stringify(questions.map((question) => ({ question: question.question, type: 'verbal', description: question.description }))),
  )
  const res = await djangoFetch('/api/training-videos/', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res, 'The training video could not be saved on the server.'))
  return res.json() as Promise<{ warning?: string; question_count?: number; video?: SavedTrainingVideo }>
}

export async function createBaSession(token: string) {
  const res = await fetch('/api/ba/sessions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) throw new Error(await parseError(res, 'Could not start assessment'))
  return res.json() as Promise<{
    sessionId: string
    questions: TrainingQuestion[]
  }>
}

export async function getBaSession(sessionId: string) {
  const res = await fetch(`/api/ba/sessions/${sessionId}/`)
  if (!res.ok) throw new Error('Session not found')
  return res.json() as Promise<{
    sessionId: string
    status: string
    questions: TrainingQuestion[]
    answers: Record<string, EngineAnswer>
  }>
}

export async function uploadBaAnswer(sessionId: string, questionId: string, audio: Blob) {
  const form = new FormData()
  form.append('audio', audio, 'answer.webm')
  form.append('questionId', questionId)
  const res = await fetch(`/api/ba/sessions/${sessionId}/answers/`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res, 'Analysis failed'))
  return res.json() as Promise<{ ok: boolean; answer: EngineAnswer }>
}

export async function finishBaSession(sessionId: string) {
  const res = await fetch(`/api/ba/sessions/${sessionId}/finish/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new Error(await parseError(res, 'Could not finish session'))
  return res.json() as Promise<EngineReport>
}

function moodLabel(value: string | undefined): MoodLabel {
  if (
    value === 'Positive' ||
    value === 'Neutral' ||
    value === 'Negative' ||
    value === 'Confident' ||
    value === 'Excited' ||
    value === 'Concerned'
  ) {
    return value
  }
  return 'Neutral'
}

export function metricsFromEngine(answer: EngineAnswer, durationSec: number): AnswerMetrics {
  const transcript = (answer.transcript ?? '').trim()
  const wordCount = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0
  const mood = moodLabel(answer.dominant_mood)
  return {
    questionId: answer.question_id,
    prompt: answer.question_title,
    durationSec: Math.round(durationSec * 10) / 10,
    transcript,
    usedTranscript: transcript.length > 0,
    words: wordCount,
    wpm: Math.round((Number(answer.speaking_speed_wpm) || 0) * 10) / 10,
    communication: Math.round((Number(answer.communication_quality) || 0) * 10) / 10,
    relevance: Math.round((Number(answer.question_relevance?.relevance_pct) || 0) * 10) / 10,
    alignment: Math.round((Number(answer.video_relevance?.relevance_pct) || 0) * 10) / 10,
    nervousness: Math.round((Number(answer.nervousness_pct) || 0) * 10) / 10,
    moodScore: mood === 'Positive' || mood === 'Confident' || mood === 'Excited' ? 2 : mood === 'Negative' || mood === 'Concerned' ? -2 : 0,
  }
}

/** Turns the report saved on the ambassador into the scores shown in the app. */
export function analysisFromReport(report: EngineReport | null | undefined) {
  if (!report || typeof report !== 'object') return null
  const perQuestion = report.per_question ?? []
  if (!perQuestion.length && report.communication_quality == null && !report.answer_count) return null
  const answers: AnswerMetrics[] = perQuestion.map((item) =>
    metricsFromEngine(
      {
        question_id: item.question_id || '',
        question_title: item.question_title || 'Question',
        transcript: item.transcript,
        communication_quality: item.communication_quality,
        speaking_speed_wpm: item.speaking_speed_wpm,
        nervousness_pct: item.nervousness_pct,
        dominant_mood: item.dominant_mood,
        question_relevance: { relevance_pct: item.relevance_pct },
        video_relevance: { relevance_pct: item.video_relevance_pct },
      },
      0,
    ),
  )
  return { result: resultFromEngine(report), answers }
}

export function resultFromEngine(report: EngineReport): AssessmentResult {
  const quality = Math.round((Number(report.communication_quality) || 0) * 10) / 10
  return {
    quality,
    communication: quality,
    relevance: Math.round((Number(report.relevance_pct) || 0) * 10) / 10,
    alignment: Math.round((Number(report.video_relevance_pct) || 0) * 10) / 10,
    wpm: Math.round((Number(report.speaking_speed_wpm) || 0) * 10) / 10,
    nervousness: Math.round((Number(report.nervousness_pct) || 0) * 10) / 10,
    mood: moodLabel(report.dominant_mood),
    certified: !!report.certified,
    usedTranscript: (report.per_question ?? []).some((item) => (item.transcript ?? '').trim().length > 0),
    completedAt: new Date().toISOString(),
    passMark: report.certification_threshold,
  }
}
