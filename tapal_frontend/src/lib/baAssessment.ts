/**
 * Scoring for a BA's verbal assessment answers.
 *
 * This is a transparent heuristic, not an AI model: it uses the browser's speech-to-text
 * transcript when available (words, pace, filler words, overlap with the question and the
 * training content) and falls back to audio activity when it is not.
 */

export type MoodLabel = 'Positive' | 'Neutral' | 'Negative' | 'Confident' | 'Excited' | 'Concerned'

export type AnswerMetrics = {
  questionId: string
  prompt: string
  durationSec: number
  transcript: string
  usedTranscript: boolean
  words: number
  wpm: number
  /** 0–100 */
  communication: number
  /** 0–100 */
  relevance: number
  /** 0–100 */
  alignment: number
  /** 0–100, lower is calmer */
  nervousness: number
  /** positive words minus negative words */
  moodScore: number
}

export type AssessmentResult = {
  quality: number
  communication: number
  relevance: number
  alignment: number
  wpm: number
  nervousness: number
  mood: MoodLabel
  certified: boolean
  usedTranscript: boolean
  completedAt: string
  /** Pass score from the engine, when the answer was scored on the server. */
  passMark?: number
}

/** Quality % needed to be certified. */
export const PASS_MARK = 40
/** An answer must be at least this long to be submitted. */
export const MIN_ANSWER_SECONDS = 5

const STOP_WORDS = new Set(
  (
    'the a an and or of to in on for with is are was be it this that you your we our they them ' +
    'how what when why which who will would can could should do does did not from at as by ' +
    'ko ka ki ke se me mein hai hain aap kaisay kese kya karaingay karain'
  ).split(' '),
)
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'hmm', 'aa', 'aah', 'ah', 'like'])
const POSITIVE = new Set(
  (
    'good great best healthy health fresh love quality delicious tasty aroma rich premium ' +
    'trusted happy enjoy better perfect favourite favorite natural pure strong'
  ).split(' '),
)
const NEGATIVE = new Set('bad worst poor hate expensive cheap weak problem difficult never'.split(' '))

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n))
const round1 = (n: number) => Math.round(n * 10) / 10

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? []
}

function keywords(text: string) {
  return new Set(words(text).filter((w) => w.length > 2 && !STOP_WORDS.has(w)))
}

/** Share of `reference` keywords that appear in `spoken`. */
function coverage(spoken: Set<string>, reference: Set<string>) {
  if (reference.size === 0) return 0
  let hit = 0
  for (const w of reference) if (spoken.has(w)) hit += 1
  return hit / reference.size
}

export function analyzeAnswer(input: {
  questionId: string
  prompt: string
  /** Training title + description + questions the answer should reflect */
  reference: string
  durationSec: number
  /** Seconds of detected speech in the audio */
  speechSec: number
  transcript: string
}): AnswerMetrics {
  const { durationSec, speechSec } = input
  const transcript = input.transcript.trim()
  const usedTranscript = transcript.length > 0
  const spokenWords = words(transcript)
  const wordCount = usedTranscript ? spokenWords.length : Math.round(speechSec * 2.2)
  const minutes = durationSec / 60
  const wpm = minutes > 0 ? wordCount / minutes : 0
  const speechRatio = durationSec > 0 ? clamp(speechSec / durationSec, 0, 1) : 0

  const paceScore = 100 - Math.min(100, Math.abs(wpm - 130) * 0.9)
  const lengthScore = Math.min(1, durationSec / 25) * 100
  const communication = clamp(paceScore * 0.5 + speechRatio * 100 * 0.3 + lengthScore * 0.2)

  let relevance: number
  let alignment: number
  let nervousness: number
  let moodScore = 0
  if (usedTranscript) {
    const spoken = new Set(spokenWords)
    relevance = clamp(coverage(spoken, keywords(`${input.prompt} ${input.reference}`)) * 250)
    alignment = clamp(coverage(spoken, keywords(input.reference)) * 250)
    const fillers = spokenWords.filter((w) => FILLERS.has(w)).length
    nervousness = clamp((fillers / Math.max(1, wordCount)) * 300 + (1 - speechRatio) * 40)
    moodScore =
      spokenWords.filter((w) => POSITIVE.has(w)).length - spokenWords.filter((w) => NEGATIVE.has(w)).length
  } else {
    relevance = clamp(35 + speechRatio * 35)
    alignment = clamp(30 + speechRatio * 30)
    nervousness = clamp((1 - speechRatio) * 60)
  }

  return {
    questionId: input.questionId,
    prompt: input.prompt,
    durationSec: round1(durationSec),
    transcript,
    usedTranscript,
    words: wordCount,
    wpm: round1(wpm),
    communication: round1(communication),
    relevance: round1(relevance),
    alignment: round1(alignment),
    nervousness: round1(nervousness),
    moodScore,
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

export function summarizeAssessment(answers: AnswerMetrics[]): AssessmentResult {
  const communication = mean(answers.map((a) => a.communication))
  const relevance = mean(answers.map((a) => a.relevance))
  const alignment = mean(answers.map((a) => a.alignment))
  const nervousness = mean(answers.map((a) => a.nervousness))
  const quality = mean([communication, relevance, alignment, 100 - nervousness])
  const totalMood = answers.reduce((s, a) => s + a.moodScore, 0)

  return {
    quality: round1(quality),
    communication: round1(communication),
    relevance: round1(relevance),
    alignment: round1(alignment),
    wpm: round1(mean(answers.map((a) => a.wpm))),
    nervousness: round1(nervousness),
    mood: totalMood >= 2 ? 'Positive' : totalMood <= -2 ? 'Negative' : 'Neutral',
    certified: quality >= PASS_MARK,
    usedTranscript: answers.some((a) => a.usedTranscript),
    completedAt: new Date().toISOString(),
  }
}
