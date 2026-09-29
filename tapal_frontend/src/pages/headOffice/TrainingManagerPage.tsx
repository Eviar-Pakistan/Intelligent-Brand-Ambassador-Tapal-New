import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { Plus, Upload, Video } from 'lucide-react'
import { Button, Card, PageHeader, StatusBadge } from '../../components/ui'
import { useTrainingContent } from '../../context/TrainingContentContext'
import {
  listTrainingVideos,
  retranscribeTrainingVideo,
  uploadTrainingVideo,
  type SavedTrainingVideo,
} from '../../lib/trainingApi'
import { CertificationRulesPanel } from './CertificationRulesPanel'

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500'

function formatUploadedAt(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown date'
  return d.toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function TrainingManagerPage() {
  const { addModule } = useTrainingContent()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [questions, setQuestions] = useState([''])
  const [toast, setToast] = useState<string | null>(null)
  const [toastOk, setToastOk] = useState(true)
  const [busy, setBusy] = useState(false)
  const [serverVideos, setServerVideos] = useState<SavedTrainingVideo[]>([])
  const [videosError, setVideosError] = useState<string | null>(null)

  async function refreshVideos() {
    try {
      setServerVideos(await listTrainingVideos())
      setVideosError(null)
    } catch (err) {
      setVideosError(err instanceof Error ? err.message : 'Could not load training videos.')
    }
  }

  useEffect(() => {
    void refreshVideos()
  }, [])

  const canSave = useMemo(() => {
    if (!title.trim() || !videoFile) return false
    return questions.every((q) => q.trim().length > 0)
  }, [title, videoFile, questions])

  async function handleSave() {
    if (!canSave || !videoFile || busy) return
    setBusy(true)
    let saved: { warning?: string } = {}
    try {
      saved = await uploadTrainingVideo(
        videoFile,
        questions.map((prompt) => ({ question: prompt.trim(), description: description.trim() })),
      )
      await refreshVideos()
    } catch (err) {
      setBusy(false)
      setToastOk(false)
      setToast(err instanceof Error ? err.message : 'The training video could not be saved on the server.')
      setTimeout(() => setToast(null), 4000)
      return
    }
    const videoUrl = URL.createObjectURL(videoFile)
    addModule(
      {
        title: title.trim(),
        description: description.trim(),
        videoName: videoFile.name,
        videoUrl,
        questions: questions.map((prompt, i) => ({
          id: `q-${Date.now()}-${i}`,
          prompt: prompt.trim(),
        })),
      },
      videoFile,
    )
    setTitle('')
    setDescription('')
    setVideoFile(null)
    setQuestions([''])
    setBusy(false)
    setToastOk(!saved.warning)
    setToast(
      saved.warning ||
        'Training video and questions saved. Ambassadors see these questions after they finish the video.',
    )
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/ho/ambassadors" className="text-sm text-slate-500 hover:text-brand-600">
          ← Ambassadors
        </Link>
      </div>

      <PageHeader
        title="Training content"
        description="Upload training videos and assessment questions for Brand Ambassadors"
      />

      {toast && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            toastOk
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {toast}
        </div>
      )}

      <Card>
        <h3 className="font-semibold text-slate-900">Upload training video</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Title</span>
            <input
              className={fieldClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Objection handling — Week 1"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Description</span>
            <textarea
              className={fieldClass}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should BAs learn from this video?"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Video file</span>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
              <Upload size={18} className="text-slate-400" />
              <div className="min-w-0 flex-1">
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-700"
                />
                {videoFile && (
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {videoFile.name} · {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
              </div>
            </div>
          </label>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">Assessment questions</h3>
            <p className="text-xs text-slate-500">
              These questions are saved with the video and shown on the BA screen. The BA answers out loud.
              The NLP analyzer scores each answer against the video transcript.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setQuestions((prev) => [...prev, ''])}
          >
            <Plus size={14} /> Add question
          </Button>
        </div>

        <div className="space-y-3">
          {questions.map((q, qi) => (
            <div key={qi} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Question {qi + 1}
                </span>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qi))}
                    className="text-xs font-semibold text-rose-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                className={fieldClass}
                value={q}
                onChange={(e) =>
                  setQuestions((prev) => prev.map((item, i) => (i === qi ? e.target.value : item)))
                }
                placeholder="Enter assessment question"
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <Button disabled={!canSave || busy} onClick={() => void handleSave()}>
            {busy ? 'Saving…' : 'Save training module'}
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-slate-900">Certification score</h3>
        <p className="mt-1 mb-4 text-xs text-slate-500">
          After the BA answers every question, this score certifies or rejects them.
        </p>
        <CertificationRulesPanel />
      </Card>

      <Card>
        <h3 className="mb-1 font-semibold text-slate-900">Saved on the server</h3>
        <p className="mb-3 text-xs text-slate-500">
          The active video is what ambassadors watch. Its questions appear after the video, and each spoken answer is scored against the transcript.
        </p>
        {videosError && <p className="mb-3 text-sm text-rose-600">{videosError}</p>}
        {serverVideos.length === 0 && !videosError ? (
          <p className="text-sm text-slate-500">No training video has been saved yet.</p>
        ) : (
          <div className="space-y-3">
            {serverVideos.map((video) => (
              <div key={video.id} className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Video size={15} className="text-brand-600" />
                  <span className="font-semibold text-slate-900">{video.original_name || 'Training video'}</span>
                  {video.is_active && <StatusBadge status="Active" />}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {video.question_count} question{video.question_count === 1 ? '' : 's'} · Uploaded{' '}
                  {formatUploadedAt(video.created_at)} ·{' '}
                  {video.transcript_preview
                    ? 'Transcript ready. Spoken answers are scored against it.'
                    : 'Transcript not ready. NLP cannot compare answers to the video yet.'}
                </p>
                {!video.transcript_preview && (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
                    onClick={() => {
                      void retranscribeTrainingVideo(video.id)
                        .then(() => refreshVideos())
                        .then(() => {
                          setToastOk(true)
                          setToast('Video transcript saved. Answers will be scored against it.')
                        })
                        .catch((err: unknown) => {
                          setToastOk(false)
                          setToast(err instanceof Error ? err.message : 'Could not transcribe this video.')
                        })
                    }}
                  >
                    Build transcript
                  </button>
                )}
                {video.questions.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    {video.questions.map((q, i) => (
                      <li key={q.id}>
                        {i + 1}. {q.question}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
