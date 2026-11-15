/**
 * LivePage — composes the real-time dashboard.
 * Contains no ML or stream code; it wires hooks to presentational parts.
 */
import { Activity } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraControls } from '@/components/camera/CameraControls'
import { PhoneWebcamHelp } from '@/components/camera/PhoneWebcamHelp'
import { CameraFeed } from '@/components/camera/CameraFeed'
import {
  ComparisonLanes,
  ComparisonPanel,
  ComparisonTimeline,
  MirroringFeed,
} from '@/components/dashboard/ComparisonPanel'
import { EmotionDonut } from '@/components/dashboard/EmotionDonut'
import { EmotionTimeline } from '@/components/dashboard/EmotionTimeline'
import { SessionStats } from '@/components/dashboard/SessionStats'
import { EmotionBars } from '@/components/detection/EmotionBars'
import { EmotionHero } from '@/components/detection/EmotionHero'
import { PersonCard } from '@/components/detection/PersonCard'
import { TransitionFeed } from '@/components/detection/TransitionFeed'
import { CollapsiblePanel, Sidebar } from '@/components/layout/Sidebar'
import { SectionTitle } from '@/components/shared/Badge'
import { useCamera } from '@/hooks/useCamera'
import { useEmotionTracking } from '@/hooks/useEmotionTracking'
import { useFaceDetection } from '@/hooks/useFaceDetection'
import { useSessionLogger } from '@/hooks/useSessionLogger'
import { useModelLoader } from '@/hooks/useModelLoader'
import { useAppStore } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import { EMOTIONS } from '@/types/emotion'
import { EMOTION_META, MAX_FACES, NO_FACE_HINT_MS } from '@/utils/constants'

export function LivePage() {
  const isMirrored = useSettingsStore((state) => state.isMirrored)
  const quality = useSettingsStore((state) => state.quality)
  const shouldShowAgeGender = useSettingsStore((state) => state.shouldShowAgeGender)
  const shouldShowFpsCounter = useSettingsStore((state) => state.shouldShowFpsCounter)
  const facingMode = useSettingsStore((state) => state.facingMode)
  const toggleFacingMode = useSettingsStore((state) => state.toggleFacingMode)

  const fps = useAppStore((state) => state.fps)

  const camera = useCamera(facingMode)
  const { isActive, stopSession } = useSessionLogger()
  const tracking = useEmotionTracking()
  const { modelStatus, ensureReady } = useModelLoader()

  const { isLowLight, isContrastEnhanced, recalibrate } = useFaceDetection({
    videoRef: camera.videoRef,
    isEnabled: camera.isOn && modelStatus.phase === 'ready',
    quality,
    shouldDetectAgeGender: shouldShowAgeGender,
  })

  const handleStart = useCallback(async () => {
    // If the engine failed, keep the camera off — starting it would leave
    // a live feed with no analysis and an orphaned recording session.
    if (!(await ensureReady())) return
    await camera.start()
  }, [camera, ensureReady])

  const handleStop = useCallback(async () => {
    camera.stop()
    await stopSession()
  }, [camera, stopSession])

  /* End the session whenever the camera goes off for ANY reason — explicit
     stop, the tab being hidden, a device error, or a permission revoke.
     Previously only the Stop button persisted the session, so a visibility
     stop silently discarded everything recorded so far. Double-calls are
     made harmless by the isStopping guard in useSessionLogger. */
  useEffect(() => {
    if (!camera.isOn && isActive) {
      void stopSession()
    }
  }, [camera.isOn, isActive, stopSession])

  /* ── auto-save when navigating away (page unmount) ── */
  const stopRef = useRef(stopSession)
  stopRef.current = stopSession
  useEffect(() => {
    return () => {
      void stopRef.current({ isSilent: true })
    }
  }, [])

  /* ── extended "no face" guidance after 10s ── */
  const [showsExtendedHint, setShowsExtendedHint] = useState(false)
  const [isWebcamHelpOpen, setIsWebcamHelpOpen] = useState(false)
  useEffect(() => {
    if (!camera.isOn || tracking.hasAnyTrack) {
      setShowsExtendedHint(false)
      return
    }
    const timer = window.setTimeout(() => setShowsExtendedHint(true), NO_FACE_HINT_MS)
    return () => window.clearTimeout(timer)
  }, [camera.isOn, tracking.hasAnyTrack])

  /* ── screen-reader announcement on emotion change ── */
  const [announcement, setAnnouncement] = useState('')
  const lastAnnouncedRef = useRef('')
  useEffect(() => {
    const face = tracking.primaryFace
    if (!face) return
    const key = `${face.id}:${face.dominant}`
    if (key === lastAnnouncedRef.current) return
    lastAnnouncedRef.current = key
    setAnnouncement(
      `Emotion changed to ${EMOTION_META[face.dominant].label}, ${Math.round(
        face.confidence * 100,
      )} percent confidence.`,
    )
  }, [tracking.primaryFace])

  const handleSelectPerson = useCallback(
    (id: number) => {
      tracking.setPinnedPersonId(tracking.pinnedPersonId === id ? null : id)
    },
    [tracking],
  )

  const { comparison, isComparing } = tracking

  return (
    // Phone: single stack. Tablet (md): 7/5 split. Laptop+ (lg): 8/4.
    <div className="grid grid-cols-1 gap-4 pb-8 md:grid-cols-12">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {/* ── feed ── */}
      <div className="md:col-span-7 lg:col-span-8">
        <div className="card overflow-hidden shadow-card">
          <CameraFeed
            videoRef={camera.videoRef}
            cameraStatus={camera.status}
            modelStatus={modelStatus}
            faces={tracking.faces}
            dimensions={camera.dimensions}
            isMirrored={isMirrored}
            shouldShowAgeGender={shouldShowAgeGender}
            isLowLight={isLowLight}
            isContrastEnhanced={isContrastEnhanced}
            hasAnyTrack={tracking.hasAnyTrack}
            showsExtendedHint={showsExtendedHint}
            fps={fps}
            shouldShowFpsCounter={shouldShowFpsCounter}
            primaryFace={tracking.primaryFace}
            onStart={() => void handleStart()}
            onRetryModels={() => void ensureReady()}
            onMetadataLoaded={camera.handleMetadataLoaded}
          />
          <CameraControls
            isOn={camera.isOn}
            isStarting={camera.status.phase === 'starting'}
            faceCount={tracking.activeFaces.length}
            durationSec={tracking.stats.durationSec}
            quality={quality}
            hasMultipleCameras={camera.hasMultipleCameras}
            availableCameras={camera.availableCameras}
            activeDeviceId={camera.activeDeviceId}
            onStart={() => void handleStart()}
            onStop={() => void handleStop()}
            onFlipCamera={toggleFacingMode}
            onSwitchCamera={(deviceId) => void camera.switchCamera(deviceId)}
            onRequestWebcamHelp={() => setIsWebcamHelpOpen(true)}
            onRecalibrate={recalibrate}
          />
        </div>
      </div>

      {/* ── right rail ── */}
      <Sidebar>
        {isComparing && <ComparisonPanel state={comparison} />}

        <CollapsiblePanel
          title="Current emotion"
          right={
            tracking.primaryFace ? (
              <span className="mono-stat text-[11px] text-ink-3">P{tracking.primaryFace.id}</span>
            ) : undefined
          }
        >
          <EmotionHero face={tracking.primaryFace} shouldShowAgeGender={shouldShowAgeGender} />
        </CollapsiblePanel>

        {/* Secondary panels start collapsed on phones to keep the feed and
            headline reading above the fold; `md:` forces them open. */}
        <CollapsiblePanel title="Emotion breakdown" defaultOpen={false}>
          <EmotionBars
            scores={tracking.primaryFace?.expressions ?? null}
            dominant={tracking.primaryFace?.dominant ?? null}
          />
        </CollapsiblePanel>

        <CollapsiblePanel
          title="Detected persons"
          defaultOpen={false}
          right={
            <span className="mono-stat text-[11px] text-ink-3">
              {tracking.activeFaces.length}/{MAX_FACES}
            </span>
          }
        >
          {tracking.activeFaces.length === 0 ? (
            <p className="py-3 text-center text-xs text-ink-3">No faces in frame</p>
          ) : (
            <div className="space-y-1.5">
              {tracking.activeFaces.map((face) => (
                <PersonCard
                  key={face.id}
                  face={face}
                  isPinned={tracking.pinnedPersonId === face.id}
                  shouldShowAgeGender={shouldShowAgeGender}
                  onSelect={handleSelectPerson}
                />
              ))}
              <p className="pt-1 text-[10px] text-ink-3">
                Tap a person to pin them as the primary subject.
              </p>
            </div>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel
          title="Transitions"
          defaultOpen={false}
          right={
            <span className="mono-stat text-[11px] text-ink-3">
              {tracking.stats.transitionCount} total
            </span>
          }
        >
          <TransitionFeed transitions={tracking.transitions} className="max-h-[218px]" />
        </CollapsiblePanel>

        {isComparing && <MirroringFeed state={comparison} />}
      </Sidebar>

      {/* ── timeline ── */}
      <div className="card p-4 sm:p-5 md:col-span-12">
        <SectionTitle
          right={
            <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 md:flex">
              {EMOTIONS.map((emotion) => (
                <span key={emotion} className="flex items-center gap-1 text-[10px] text-ink-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: EMOTION_META[emotion].color }}
                  />
                  {EMOTION_META[emotion].label}
                </span>
              ))}
            </div>
          }
        >
          Emotion timeline · last 60 s
        </SectionTitle>
        <EmotionTimeline
          samples={tracking.timeline}
          idleHint="Timeline fills in while faces are detected"
        />
      </div>

      {/* ── comparison detail ── */}
      {isComparing && (
        <div className="card p-4 sm:p-5 md:col-span-12">
          <SectionTitle
            right={
              <span className="text-[11px] tracking-normal normal-case text-ink-3">
                shaded band = emotion gap
              </span>
            }
          >
            Person comparison · P{comparison.people[0]?.id} vs P{comparison.people[1]?.id}
          </SectionTitle>
          <ComparisonTimeline state={comparison} height={190} />
          <div className="mt-4 border-t border-line pt-4">
            <p className="panel-title mb-2.5">Dominant emotion over time</p>
            <ComparisonLanes state={comparison} />
          </div>
        </div>
      )}

      {/* ── session overview ── */}
      <div className="card p-4 sm:p-5 md:col-span-12">
        <SectionTitle right={<span className="text-[11px] text-ink-3">This session</span>}>
          Session overview
        </SectionTitle>
        <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[1fr_auto]">
          <SessionStats stats={tracking.stats} isComparing={isComparing} />
          <div className="justify-self-center lg:justify-self-end">
            <EmotionDonut distribution={tracking.stats.distribution} size={150} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[11px] text-ink-3">
          <Activity size={12} className="text-primary" />
          Dominant so far:&nbsp;
          <span className="font-medium text-ink-2">
            {EMOTION_META[tracking.stats.dominantEmotion].label}
          </span>
        </div>
      </div>

      {/* Phone-as-webcam setup guide */}
      <PhoneWebcamHelp isOpen={isWebcamHelpOpen} onClose={() => setIsWebcamHelpOpen(false)} />
    </div>
  )
}
