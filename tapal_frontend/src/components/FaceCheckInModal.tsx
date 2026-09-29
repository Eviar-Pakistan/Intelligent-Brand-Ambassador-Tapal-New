import { useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, ScanFace } from 'lucide-react'
import { Modal } from './ui'

const FACE_SCRIPT = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/face_detection.js'
const FACE_ASSET = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection'

type Detector = {
  detect: (video: HTMLVideoElement, timestampMs: number) => Promise<boolean>
}

type MpFaceDetection = {
  setOptions: (options: { model: 'short'; minDetectionConfidence: number }) => void
  onResults: (callback: (results: { detections?: unknown[] }) => void) => void
  send: (input: { image: HTMLVideoElement }) => Promise<void>
  close: () => void
}

let sharedDetector: Promise<Detector> | null = null

function loadDetector(): Promise<Detector> {
  if (!sharedDetector) {
    sharedDetector = createDetector().catch((error) => {
      sharedDetector = null
      throw error
    })
  }
  return sharedDetector
}

function loadScript(src: string) {
  const existing = document.querySelector(`script[src="${src}"]`)
  if (existing) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load face detection'))
    document.head.appendChild(script)
  })
}

async function createDetector(): Promise<Detector> {
  await loadScript(FACE_SCRIPT)
  const FaceDetection = (
    window as Window & {
      FaceDetection?: new (config: { locateFile: (file: string) => string }) => MpFaceDetection
    }
  ).FaceDetection
  if (!FaceDetection) throw new Error('Face detection is unavailable')

  const faceDetection = new FaceDetection({
    locateFile: (file) => `${FACE_ASSET}/${file}`,
  })
  faceDetection.setOptions({ model: 'short', minDetectionConfidence: 0.5 })

  let settle: ((seen: boolean) => void) | null = null
  faceDetection.onResults((results) => {
    settle?.((results.detections?.length ?? 0) > 0)
    settle = null
  })

  return {
    detect: (video) =>
      new Promise<boolean>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          settle = null
          reject(new Error('Face detection timed out'))
        }, 20000)
        settle = (seen) => {
          window.clearTimeout(timer)
          resolve(seen)
        }
        faceDetection.send({ image: video }).catch((error: unknown) => {
          window.clearTimeout(timer)
          settle = null
          reject(error)
        })
      }),
  }
}

export function captureVideoFrame(video: HTMLVideoElement) {
  if (video.videoWidth < 2 || video.videoHeight < 2) return undefined
  const maxEdge = 1280
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  try {
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return undefined
  }
}

export function FaceCheckInModal({
  open,
  onClose,
  onConfirmed,
  title = 'Face check-in',
  confirmLabel = 'Check In',
  scanningMessage = 'No face detected. Look at the camera to check in.',
  readyMessage = 'Face detected. You can check in now.',
}: {
  open: boolean
  onClose: () => void
  onConfirmed: (selfie?: string) => void
  title?: string
  confirmLabel?: string
  scanningMessage?: string
  readyMessage?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'ready' | 'error'>('starting')
  const [message, setMessage] = useState('Opening the front camera…')
  const faceReady = status === 'ready'

  useEffect(() => {
    if (!open) return

    const video = videoRef.current
    if (!video) return

    let stopped = false
    let stream: MediaStream | null = null
    let timer = 0
    let hits = 0

    setStatus('starting')
    setMessage('Opening the front camera…')

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
        setMessage('This browser cannot open the camera, so check-in is blocked.')
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        })
      } catch {
        if (stopped) return
        setStatus('error')
        setMessage('Camera permission is required. Check-in stays blocked until a face is seen.')
        return
      }

      if (stopped) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      video!.srcObject = stream
      await video!.play()
      setMessage('Loading face detection…')

      let detector: Detector
      try {
        detector = await loadDetector()
      } catch {
        if (stopped) return
        setStatus('error')
        setMessage('Face detection could not start. Check-in is blocked.')
        return
      }

      if (stopped) return
      setStatus('scanning')
      setMessage(scanningMessage)

      const tick = async () => {
        if (stopped) return
        const el = videoRef.current
        if (el && el.readyState >= 2 && el.videoWidth > 0) {
          try {
            const seen = await detector.detect(el, performance.now())
            hits = seen ? Math.min(hits + 1, 4) : 0
            if (hits >= 3) {
              setStatus('ready')
              setMessage(readyMessage)
            } else {
              setStatus('scanning')
              setMessage(scanningMessage)
            }
          } catch {
            hits = 0
            setStatus('scanning')
            setMessage(scanningMessage)
          }
        }
        if (!stopped) timer = window.setTimeout(() => void tick(), 280)
      }

      void tick()
    }

    void start()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      if (video) {
        video.pause()
        video.srcObject = null
      }
    }
  }, [open, readyMessage, scanningMessage])

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-slate-950">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="aspect-[4/3] w-full -scale-x-100 bg-slate-900 object-cover"
          />
          <div
            className={`pointer-events-none absolute inset-6 rounded-3xl border-2 ${
              faceReady ? 'border-emerald-400' : 'border-white/70'
            }`}
          />
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-xl bg-black/55 px-3 py-2 text-xs font-semibold text-white">
            {faceReady ? <CheckCircle2 size={16} className="text-emerald-300" /> : <ScanFace size={16} />}
            <span>{message}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            disabled={!faceReady}
            onClick={() => onConfirmed(videoRef.current ? captureVideoFrame(videoRef.current) : undefined)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 sm:w-auto sm:px-5"
          >
            <Camera size={16} />
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:px-5"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
