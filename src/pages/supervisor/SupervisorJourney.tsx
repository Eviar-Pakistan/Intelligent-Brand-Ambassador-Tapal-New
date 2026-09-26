import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Camera, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { FaceCheckInModal, captureVideoFrame } from '../../components/FaceCheckInModal'
import { Button, Card, CardHeader, Modal, PageHeader, StatusBadge } from '../../components/ui'
import { stores } from '../../data/mock'
import {
  WEEKDAYS,
  completeVisit,
  currentWeekStart,
  formatWeekLabel,
  planFor,
  shiftWeek,
  useJourneyPlans,
  useJourneyVisits,
  visitFor,
  weekdayOf,
  type JourneyStop,
  type JourneyVisit,
  type Weekday,
} from '../../lib/journeyPlans'
import { useCreatedStores } from '../../lib/storeRegistry'
import { signOut, useSupervisorSession, type Supervisor } from '../../lib/supervisors'

type VisitDraft = {
  storeId: number
  day: Weekday
  weekStart: string
  step: 'location' | 'selfie' | 'photos'
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  selfie: string
  baPhoto: string
  stockPhoto: string
  locationError: string | null
  locating: boolean
}

function storeName(storeId: number) {
  return stores.find((store) => store.id === storeId)?.name ?? `Store #${storeId}`
}

function storeCity(storeId: number) {
  return stores.find((store) => store.id === storeId)?.city ?? ''
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function mapsUrl(latitude: number, longitude: number) {
  return `https://maps.google.com/?q=${latitude},${longitude}`
}

export function JourneyWeekPanel({
  supervisor,
  weekStart,
  onWeekStart,
  action,
  onStartVisit,
  onViewVisit,
}: {
  supervisor: Supervisor
  weekStart: string
  onWeekStart: (next: string) => void
  action?: ReactNode
  onStartVisit?: (stop: JourneyStop) => void
  onViewVisit?: (visit: JourneyVisit) => void
}) {
  useCreatedStores()
  useJourneyPlans()
  useJourneyVisits()
  const plan = planFor(supervisor.id, weekStart)
  const today = weekdayOf()
  const thisWeek = weekStart === currentWeekStart()
  const done = plan?.stops.filter((stop) => visitFor(supervisor.id, weekStart, stop)).length ?? 0

  return (
    <Card>
      <CardHeader
        title="Weekly journey plan"
        subtitle={
          plan
            ? `${formatWeekLabel(weekStart)} · ${plan.stops.length} store ${plan.stops.length === 1 ? 'visit' : 'visits'} · ${done} completed`
            : `${formatWeekLabel(weekStart)} · no plan assigned`
        }
        action={action}
      />
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => onWeekStart(shiftWeek(weekStart, -1))}>
          <ChevronLeft size={14} /> Previous
        </Button>
        <div className="text-center text-sm font-semibold text-slate-700">
          {formatWeekLabel(weekStart)}
          {thisWeek && <span className="mt-0.5 block text-xs font-medium text-brand-600">This week</span>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => onWeekStart(shiftWeek(weekStart, 1))}>
          Next <ChevronRight size={14} />
        </Button>
      </div>

      {!plan && (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Head Office has not assigned a journey plan for this week.
        </p>
      )}

      {plan && (
        <div className="space-y-3">
          {WEEKDAYS.map((day) => {
            const stops = plan.stops.filter((stop) => stop.day === day)
            return (
              <div key={day} className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-800">
                    {day}
                    {thisWeek && day === today && <span className="ml-2 text-xs font-medium text-brand-600">Today</span>}
                  </span>
                  <span className="text-xs text-slate-400">
                    {stops.length === 0 ? 'No store' : `${stops.length} store${stops.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                {stops.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-slate-400">No store scheduled.</p>
                ) : (
                  <ul>
                    {stops.map((stop) => {
                      const visit = visitFor(supervisor.id, weekStart, stop)
                      return (
                        <li
                          key={`${stop.day}-${stop.storeId}`}
                          className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5 first:border-t-0"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900">{storeName(stop.storeId)}</div>
                            <div className="text-xs text-slate-400">
                              {storeCity(stop.storeId)}
                              {visit ? ` · ${formatWhen(visit.completedAt)}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={visit ? 'Completed' : 'Scheduled'} />
                            {visit && onViewVisit && (
                              <Button size="sm" variant="secondary" onClick={() => onViewVisit(visit)}>
                                View
                              </Button>
                            )}
                            {!visit && onStartVisit && (
                              <Button size="sm" onClick={() => onStartVisit(stop)}>
                                <MapPin size={13} /> Start visit
                              </Button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export function VisitDetailModal({ visit, onClose }: { visit: JourneyVisit | null; onClose: () => void }) {
  useCreatedStores()
  return (
    <Modal open={!!visit} onClose={onClose} title={visit ? `Visit · ${storeName(visit.storeId)}` : 'Visit'}>
      {visit && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            {visit.day} · {storeCity(visit.storeId)} · {formatWhen(visit.completedAt)}
          </p>
          <a
            href={mapsUrl(visit.latitude, visit.longitude)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
          >
            <MapPin size={14} />
            {visit.latitude.toFixed(5)}, {visit.longitude.toFixed(5)}
            {visit.accuracy != null ? ` · ±${Math.round(visit.accuracy)} m` : ''}
          </a>
          <div className="grid gap-3 sm:grid-cols-3">
            <EvidenceShot label="Selfie" src={visit.selfie} />
            <EvidenceShot label="BA" src={visit.baPhoto} />
            <EvidenceShot label="Stock" src={visit.stockPhoto} />
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function EvidenceShot({ label, src }: { label: string; src: string }) {
  return (
    <figure>
      <img src={src} alt={label} className="aspect-[4/3] w-full rounded-xl bg-slate-100 object-cover" />
      <figcaption className="mt-1 text-center text-xs font-medium text-slate-500">{label}</figcaption>
    </figure>
  )
}

function usePortal(title: string, description: string) {
  const { supervisor, preview } = useSupervisorSession()
  const header = (
    <>
      {preview && supervisor && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>
            Head Office preview — you are viewing the portal as <strong>{supervisor.name}</strong>.
          </span>
          <Link to="/ho/supervisors" onClick={signOut} className="text-xs font-semibold text-amber-900 underline">
            Exit preview
          </Link>
        </div>
      )}
      <PageHeader title={title} description={supervisor ? `${supervisor.name} · ${description}` : description} />
    </>
  )
  return { supervisor, header }
}

export function SupervisorJourneyPage() {
  const { supervisor, header } = usePortal('Journey plan', 'stores Head Office scheduled for you this week')
  const [weekStart, setWeekStart] = useState(currentWeekStart)
  const [draft, setDraft] = useState<VisitDraft | null>(null)
  const [view, setView] = useState<JourneyVisit | null>(null)

  useEffect(() => {
    if (!draft || draft.step !== 'location' || !draft.locating || draft.latitude != null) return
    let cancelled = false
    if (!navigator.geolocation) {
      setDraft((current) =>
        current && { ...current, locating: false, locationError: 'This browser cannot read location.' },
      )
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        setDraft((current) =>
          current && {
            ...current,
            locating: false,
            locationError: null,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          },
        )
      },
      () => {
        if (cancelled) return
        setDraft((current) =>
          current && {
            ...current,
            locating: false,
            locationError: 'Allow location access, then try again. The visit needs the store location.',
          },
        )
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
    return () => {
      cancelled = true
    }
  }, [draft])

  function startVisit(stop: JourneyStop) {
    setDraft({
      storeId: stop.storeId,
      day: stop.day,
      weekStart,
      step: 'location',
      latitude: null,
      longitude: null,
      accuracy: null,
      selfie: '',
      baPhoto: '',
      stockPhoto: '',
      locationError: null,
      locating: true,
    })
  }

  function finishVisit() {
    if (!draft || !supervisor || draft.latitude == null || draft.longitude == null) return
    if (!draft.selfie || !draft.baPhoto || !draft.stockPhoto) return
    completeVisit({
      supervisorId: supervisor.id,
      weekStart: draft.weekStart,
      day: draft.day,
      storeId: draft.storeId,
      latitude: draft.latitude,
      longitude: draft.longitude,
      accuracy: draft.accuracy,
      selfie: draft.selfie,
      baPhoto: draft.baPhoto,
      stockPhoto: draft.stockPhoto,
    })
    setDraft(null)
  }

  return (
    <div className="space-y-5">
      {header}
      {supervisor ? (
        <JourneyWeekPanel
          supervisor={supervisor}
          weekStart={weekStart}
          onWeekStart={setWeekStart}
          onStartVisit={startVisit}
          onViewVisit={setView}
        />
      ) : (
        <Card>
          <p className="text-sm text-slate-500">Sign in to see your journey plan.</p>
        </Card>
      )}

      <Modal
        open={draft?.step === 'location'}
        onClose={() => setDraft(null)}
        title={draft ? `Arrive · ${storeName(draft.storeId)}` : 'Arrive'}
      >
        {draft && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              {draft.day} · {storeCity(draft.storeId)}. Your location is recorded when you reach this store, then you
              take a selfie.
            </p>
            {draft.locating && <p className="font-medium text-slate-700">Capturing your location…</p>}
            {draft.locationError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {draft.locationError}
              </div>
            )}
            {draft.latitude != null && draft.longitude != null && (
              <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">
                <MapPin size={16} className="mt-0.5 shrink-0" />
                <span>
                  {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}
                  {draft.accuracy != null ? ` · ±${Math.round(draft.accuracy)} m` : ''}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              {draft.latitude != null && (
                <Button onClick={() => setDraft((current) => current && { ...current, step: 'selfie' })}>
                  <Camera size={14} /> Continue to selfie
                </Button>
              )}
              {draft.latitude == null && !draft.locating && (
                <Button
                  onClick={() => setDraft((current) => current && { ...current, locating: true, locationError: null })}
                >
                  <MapPin size={14} /> Try location again
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <FaceCheckInModal
        open={draft?.step === 'selfie'}
        title="Supervisor selfie"
        confirmLabel="Use this selfie"
        scanningMessage="No face detected. Look at the camera."
        readyMessage="Face detected. You can save this selfie."
        onClose={() => setDraft((current) => current && { ...current, step: 'location' })}
        onConfirmed={(selfie) => {
          if (!selfie) return
          setDraft((current) => current && { ...current, selfie, step: 'photos' })
        }}
      />

      <PhotosStep
        key={draft ? `${draft.weekStart}-${draft.day}-${draft.storeId}` : 'idle'}
        draft={draft?.step === 'photos' ? draft : null}
        onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
        onBack={() => setDraft((current) => current && { ...current, step: 'selfie', selfie: '' })}
        onClose={() => setDraft(null)}
        onComplete={finishVisit}
      />

      <VisitDetailModal visit={view} onClose={() => setView(null)} />
    </div>
  )
}

function PhotosStep({
  draft,
  onChange,
  onBack,
  onClose,
  onComplete,
}: {
  draft: VisitDraft | null
  onChange: (patch: Partial<Pick<VisitDraft, 'baPhoto' | 'stockPhoto'>>) => void
  onBack: () => void
  onClose: () => void
  onComplete: () => void
}) {
  const [camera, setCamera] = useState<'ba' | 'stock' | null>(null)
  const ready = !!draft?.baPhoto && !!draft.stockPhoto

  return (
    <Modal open={!!draft} onClose={onClose} title={draft ? `BA and stock · ${storeName(draft.storeId)}` : 'BA and stock'}>
      {draft && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">Take a picture of the BA and a picture of the stock to complete this visit.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ShotSlot
              label="BA"
              hint="The ambassador at this store"
              image={draft.baPhoto}
              live={camera === 'ba'}
              onOpen={() => setCamera('ba')}
              onShot={(baPhoto) => {
                onChange({ baPhoto })
                setCamera(null)
              }}
              onCloseCamera={() => setCamera(null)}
            />
            <ShotSlot
              label="Stock"
              hint="The shelf or stock on display"
              image={draft.stockPhoto}
              live={camera === 'stock'}
              onOpen={() => setCamera('stock')}
              onShot={(stockPhoto) => {
                onChange({ stockPhoto })
                setCamera(null)
              }}
              onCloseCamera={() => setCamera(null)}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="success" disabled={!ready} onClick={onComplete}>
              Complete visit
            </Button>
            <Button variant="secondary" onClick={onBack}>
              Retake selfie
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ShotSlot({
  label,
  hint,
  image,
  live,
  onOpen,
  onShot,
  onCloseCamera,
}: {
  label: string
  hint: string
  image: string
  live: boolean
  onOpen: () => void
  onShot: (dataUrl: string) => void
  onCloseCamera: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!live) return
    const video = videoRef.current
    if (!video) return
    let stopped = false
    let stream: MediaStream | null = null
    setError(null)

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot open the camera.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
        } catch {
          if (!stopped) setError('Camera permission is required to take this picture.')
          return
        }
      }
      if (stopped) {
        stream?.getTracks().forEach((track) => track.stop())
        return
      }
      video!.srcObject = stream
      await video!.play()
    }

    void start()
    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
      if (video) {
        video.pause()
        video.srcObject = null
      }
    }
  }, [live])

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-sm font-semibold text-slate-800">{label}</div>
      <p className="text-xs text-slate-400">{hint}</p>
      {image && !live && <img src={image} alt={label} className="mt-2 aspect-[4/3] w-full rounded-xl object-cover" />}
      {live && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="mt-2 aspect-[4/3] w-full rounded-xl bg-slate-900 object-cover"
        />
      )}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {!live ? (
          <Button type="button" size="sm" variant="secondary" onClick={onOpen}>
            <Camera size={13} /> {image ? 'Retake' : 'Take picture'}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const shot = videoRef.current ? captureVideoFrame(videoRef.current) : undefined
                if (!shot) {
                  setError('Hold still and capture again.')
                  return
                }
                onShot(shot)
              }}
            >
              Capture
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCloseCamera}>
              Close camera
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
