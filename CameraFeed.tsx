/**
 * CameraFeed — the video surface plus every camera-related visual state.
 * Renders only; all stream logic lives in useCamera.
 */
import { AlertTriangle, Camera, CameraOff, RefreshCw, ScanFace } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { FaceOverlay } from './FaceOverlay'
import { Button } from '@/components/shared/Button'
import { EmotionIcon } from '@/components/shared/EmotionIcon'
import { useAppStore } from '@/store/appStore'
import { EMOTION_META } from '@/utils/constants'
import { getPerformancePreset } from '@/utils/hardware'
import { formatPercent } from '@/utils/formatters'
import type { TrackedFace } from '@/types/face'
import type { CameraStatus, ModelStatus } from '@/types/settings'
import { cn } from '@/utils/cn'

interface CameraFeedProps {
  videoRef: RefObject<HTMLVideoElement | null>
  cameraStatus: CameraStatus
  modelStatus: ModelStatus
  faces: readonly TrackedFace[]
  dimensions: { width: number; height: number }
  isMirrored: boolean
  shouldShowAgeGender: boolean
  isLowLight: boolean
  isContrastEnhanced: boolean
  hasAnyTrack: boolean
  showsExtendedHint: boolean
  fps: number
  shouldShowFpsCounter: boolean
  /** Drives the compact phone-only emotion badge over the feed. */
  primaryFace: TrackedFace | null
  onStart: () => void
  onRetryModels: () => void
  onMetadataLoaded: () => void
}

export function CameraFeed({
  videoRef,
  cameraStatus,
  modelStatus,
  faces,
  dimensions,
  isMirrored,
  shouldShowAgeGender,
  isLowLight,
  isContrastEnhanced,
  hasAnyTrack,
  showsExtendedHint,
  fps,
  shouldShowFpsCounter,
  primaryFace,
  onStart,
  onRetryModels,
  onMetadataLoaded,
}: CameraFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState({ width: 0, height: 0 })

  // Overlay maths need the RENDERED size, which changes with layout.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = () =>
      setContainer({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const isOn = cameraStatus.phase === 'on'
  const isModelLoading = modelStatus.phase === 'loading'

  return (
    // 4:3 on phones gives a taller frame for selfie framing; 16:9 from `sm`
    // up. max-h-[70vh] stops the feed pushing controls off-screen in
    // landscape. The overlay measures the RENDERED box, so any clamping is
    // absorbed automatically.
    <div
      ref={containerRef}
      className="relative aspect-[4/3] max-h-[70vh] w-full overflow-hidden bg-[#0B1424] sm:aspect-video"
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onLoadedMetadata={onMetadataLoaded}
        className={cn(
          'absolute inset-0 h-full w-full object-cover',
          isMirrored && '-scale-x-100',
        )}
        aria-label="Live camera feed"
      />

      {isLowLight && isOn && (
        <div className="absolute inset-x-0 top-0 z-20 flex justify-center p-3">
          <span className="chip bg-[#FEF3C7] text-[#B45309] shadow-sm">
            <AlertTriangle size={12} />
            {isContrastEnhanced
              ? 'Low lighting detected — auto-contrast enhancement active.'
              : 'Low light detected. Results may be less accurate.'}
          </span>
        </div>
      )}

      {isOn && (
        <FaceOverlay
          faces={faces}
          sourceWidth={dimensions.width}
          sourceHeight={dimensions.height}
          containerWidth={container.width}
          containerHeight={container.height}
          isMirrored={isMirrored}
          shouldShowAgeGender={shouldShowAgeGender}
        />
      )}

      {isOn && modelStatus.phase === 'ready' && !hasAnyTrack && (
        <div className="absolute inset-0 z-10 grid place-items-center px-6">
          <div className="pulse-soft flex flex-col items-center gap-3 text-center">
            <ScanFace size={46} className="text-slate-400" strokeWidth={1.4} />
            <p className="text-sm text-slate-400">Position your face in the camera</p>
            {showsExtendedHint && (
              <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                No faces detected. Make sure you&apos;re facing the camera and the room is
                well-lit.
              </p>
            )}
          </div>
        </div>
      )}

      {/* status chips */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <span className="chip border border-line bg-white/90 shadow-sm backdrop-blur-sm">
          <span className="relative flex h-2 w-2">
            {isOn && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            )}
            <span
              className={cn(
                'relative inline-flex h-2 w-2 rounded-full',
                isOn ? 'bg-primary' : 'bg-ink-3',
              )}
            />
          </span>
          <span
            className={cn(
              'text-[11px] font-semibold tracking-wide',
              isOn ? 'text-ink' : 'text-ink-2',
            )}
          >
            {isOn ? 'LIVE' : 'STANDBY'}
          </span>
        </span>
      </div>

      {isOn && dimensions.height > 0 && (
        <span className="chip mono-stat absolute top-3 right-3 z-20 hidden border border-line bg-white/90 text-[11px] text-ink-2 shadow-sm backdrop-blur-sm sm:inline-flex">
          {dimensions.height}p
        </span>
      )}

      {/* Phone-only summary: the detail panels are collapsed below `md`,
          so the headline reading is surfaced over the feed itself. */}
      {isOn && primaryFace && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-20 md:hidden">
          <span className="flex items-center gap-2 rounded-full border border-line bg-white/95 py-1.5 pr-3 pl-2 shadow-sm backdrop-blur-sm">
            <EmotionIcon emotion={primaryFace.dominant} size={18} />
            <span className="text-[13px] font-semibold text-ink">
              {EMOTION_META[primaryFace.dominant].label}
            </span>
            {!primaryFace.isLowConfidence && (
              <span className="mono-stat text-[12px] text-ink-2">
                {formatPercent(primaryFace.confidence)}
              </span>
            )}
          </span>
        </div>
      )}

      {isOn && shouldShowFpsCounter && (
        <PerformanceChip fps={fps} />
      )}

      {isOn && isModelLoading && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#0B1424]/70">
          <div className="flex w-56 flex-col items-center gap-3">
            <span className="spin-slow h-7 w-7 rounded-full border-2 border-primary/25 border-t-primary" />
            <p className="text-sm text-slate-300">Loading neural models…</p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.round(modelStatus.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {modelStatus.phase === 'error' && (
        <FeedState
          icon={<AlertTriangle size={30} className="text-warning" />}
          title="AI model failed to load"
          description={modelStatus.message}
          action={
            <Button onClick={onRetryModels} icon={<RefreshCw size={14} />}>
              Retry
            </Button>
          }
        />
      )}

      {modelStatus.phase !== 'error' && cameraStatus.phase === 'off' && (
        <FeedState
          icon={<Camera size={30} className="text-ink-3" />}
          title="Camera is off"
          description="Start a session to begin real-time emotion analysis. Everything runs on-device and nothing is uploaded."
          action={
            <Button onClick={onStart} icon={<Camera size={14} />}>
              Start Camera
            </Button>
          }
        />
      )}

      {cameraStatus.phase === 'starting' && (
        <FeedState
          icon={
            <span className="spin-slow h-7 w-7 rounded-full border-2 border-primary/25 border-t-primary" />
          }
          title="Requesting camera access…"
          description="Your browser will ask for permission."
        />
      )}

      {cameraStatus.phase === 'error' && (
        <FeedState
          icon={<CameraOff size={30} className="text-ink-3" />}
          title={
            cameraStatus.reason === 'denied'
              ? 'Camera access is required'
              : cameraStatus.reason === 'notFound'
                ? 'No camera found'
                : cameraStatus.reason === 'busy'
                  ? 'Camera is busy'
                  : 'Camera unavailable'
          }
          description={cameraStatus.message}
          action={
            cameraStatus.reason === 'unsupported' ? undefined : (
              <Button onClick={onStart} icon={<RefreshCw size={14} />}>
                {cameraStatus.reason === 'denied' ? 'Enable Camera' : 'Retry'}
              </Button>
            )
          }
        />
      )}
    </div>
  )
}

/**
 * Performance diagnostics chip: FPS · latency · heap · preset.
 *
 * Heap comes from performance.memory (Chromium only — guarded; other
 * browsers show an em dash) on a 1 s interval, invisible next to the
 * chip's own 1 Hz FPS updates. Color thresholds per the performance
 * directive: green ≥25, amber 15–24, red <15.
 */
function PerformanceChip({ fps }: { fps: number }) {
  const latencyMs = useAppStore((state) => state.inferenceLatencyMs)
  const [heapMb, setHeapMb] = useState<number | null>(null)

  useEffect(() => {
    const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
    if (!memory) return
    const read = () => setHeapMb(Math.round(memory.usedJSHeapSize / 1_048_576))
    read()
    const timer = window.setInterval(read, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const tone = fps >= 25 ? 'text-success' : fps >= 15 ? 'text-warning' : 'text-danger'
  const preset = getPerformancePreset().name

  return (
    <span
      className={cn(
        'mono-stat absolute right-3 bottom-3 z-20 rounded-md bg-black/45 px-2 py-1',
        'text-[11px] font-semibold backdrop-blur-sm',
        tone,
      )}
      title={`${fps} FPS | Latency: ${latencyMs}ms | Heap: ${heapMb ?? '—'}MB | Preset: ${preset}`}
      aria-label={`Detection running at ${fps} frames per second, latency ${latencyMs} milliseconds, preset ${preset}`}
    >
      {fps} FPS · {latencyMs}ms · {heapMb ?? '—'}MB · {preset}
    </span>
  )
}

function FeedState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#0B1424] px-6">
      <div className="flex max-w-sm flex-col items-center gap-2.5 text-center">
        {icon}
        <p className="font-display text-base font-semibold text-white">{title}</p>
        {description && <p className="text-[13px] leading-relaxed text-slate-400">{description}</p>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  )
}
