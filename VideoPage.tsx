/**
 * VideoPage — frame-by-frame analysis of a recorded video file.
 * Render-only: the processing pipeline, analytics and persistence live in
 * useVideoAnalysis; this component owns playback state and markup.
 */
import {
  AlertTriangle,
  Clapperboard,
  Download,
  FileVideo,
  FlaskConical,
  Pause,
  Play,
  Repeat2,
  Save,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FaceMarker } from '@/components/camera/FaceOverlay'
import { EmotionDonut } from '@/components/dashboard/EmotionDonut'
import { EmotionTimeline } from '@/components/dashboard/EmotionTimeline'
import { StatTile } from '@/components/dashboard/SessionStats'
import { EmotionBars } from '@/components/detection/EmotionBars'
import { Button } from '@/components/shared/Button'
import { EmotionIcon } from '@/components/shared/EmotionIcon'
import { PersonBadge, SectionTitle, Toggle } from '@/components/shared/Badge'
import { useVideoAnalysis } from '@/hooks/useVideoAnalysis'
import { getPrimaryVideoFace, getSynchronyLabel } from '@/services/emotionAnalyzer'
import { useSettingsStore } from '@/store/settingsStore'
import { EMOTIONS } from '@/types/emotion'
import {
  EMOTION_META,
  MAX_VIDEO_MB,
} from '@/utils/constants'
import { formatClock, formatDuration, formatPercent } from '@/utils/formatters'
import { cn } from '@/utils/cn'

const SPEEDS = [0.5, 1, 1.5, 2] as const

const TONE_CLASSES: Record<string, string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-[#FEF3C7] text-[#B45309]',
  success: 'bg-success/10 text-success',
  accent: 'bg-accent/10 text-accent',
}

export function VideoPage() {
  const shouldShowAgeGender = useSettingsStore((state) => state.shouldShowAgeGender)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    phase,
    meta,
    progress,
    isLongVideo,
    sampleFps,
    isDemoMode,
    setIsDemoMode,
    frames,
    transitions,
    analytics,
    isSaved,
    selectFile,
    cancelAndReset,
    saveToHistory,
    exportReport,
  } = useVideoAnalysis(
    useCallback(() => videoRef.current, []),
  )

  const [isDragOver, setIsDragOver] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [rate, setRate] = useState<number>(1)

  /* ── playback → overlay sync (~10 Hz, paused while hidden) ── */
  useEffect(() => {
    if (phase !== 'ready') return
    let handle = 0
    let lastUpdateMs = 0
    const tick = () => {
      handle = requestAnimationFrame(tick)
      const video = videoRef.current
      if (!video) return
      // While this page is hidden (another tab is active) a 60 fps
      // re-render loop would burn CPU for an invisible component.
      if (document.hidden || video.offsetParent === null) return
      // 10 Hz is plenty for a playhead; 60 Hz would re-render the whole
      // chart 60 times a second.
      const now = performance.now()
      if (now - lastUpdateMs < 100) return
      lastUpdateMs = now
      setCurrentTime(video.currentTime)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [phase])

  // Reset the playhead whenever a new analysis lands.
  useEffect(() => {
    if (phase === 'ready') setCurrentTime(0)
  }, [phase])

  const frameIndex = useMemo(() => {
    if (frames.length === 0) return 0
    return Math.max(0, Math.min(frames.length - 1, Math.round(currentTime * sampleFps)))
  }, [currentTime, frames.length, sampleFps])

  const activeFaces = frames[frameIndex]?.faces ?? []

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play()
      setIsPlaying(true)
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }, [])

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(video.duration || 0, time))
    setCurrentTime(video.currentTime)
  }, [])

  /* ── keyboard transport (Space = play/pause, ←/→ = ±5 s) ── */
  useEffect(() => {
    if (phase !== 'ready') return
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isTyping) return
      // When a button has focus, Space already activates it natively —
      // handling it here too would toggle play/pause twice (a no-op).
      if (target?.tagName === 'BUTTON' || target?.closest('button')) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seek((videoRef.current?.currentTime ?? 0) - 5)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seek((videoRef.current?.currentTime ?? 0) + 5)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, togglePlay, seek])

  const percentDone = progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="pb-10">
      {phase === 'idle' && (
        <div className="mx-auto max-w-3xl">
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,video/*"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void selectFile(file)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragOver(true)
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragOver(false)
              const file = event.dataTransfer.files?.[0]
              if (file) void selectFile(file)
            }}
            aria-label="Upload a video file for emotion analysis"
            className={cn(
              'flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-20 text-center transition-all duration-200',
              isDragOver
                ? 'border-solid border-primary bg-primary-100'
                : 'border-[#CBD5E1] bg-canvas hover:border-primary hover:bg-primary-50',
            )}
          >
            <span
              className={cn(
                'grid h-14 w-14 place-items-center rounded-full transition-colors duration-200',
                isDragOver ? 'bg-white text-primary' : 'bg-white text-ink-3 shadow-sm',
              )}
            >
              <Clapperboard size={24} strokeWidth={1.8} />
            </span>
            <p className="mt-4 font-display text-base font-semibold text-ink">
              Upload a Video File
            </p>
            <p className="mt-1.5 text-sm text-ink-2">Drag &amp; drop or click to browse</p>
            <p className="mt-1 text-xs text-ink-3">MP4, WEBM, MOV, AVI · Max {MAX_VIDEO_MB}MB</p>
            <p className="mt-6 flex items-center gap-1.5 rounded-lg bg-surface-alt px-3 py-2 text-[11px] text-ink-2">
              <AlertTriangle size={13} className="text-warning" />
              Processing happens locally. Your video is never uploaded to any server.
            </p>
          </button>
        </div>
      )}

      {phase !== 'idle' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {meta?.name}
              {meta && (
                <span className="mono-stat ml-2 text-[11px] font-normal text-ink-3">
                  {meta.width}×{meta.height} · {formatClock(meta.duration)}
                </span>
              )}
            </p>
            {phase === 'ready' && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exportReport}
                  icon={<Download size={14} />}
                >
                  Export report
                </Button>
                <Button
                  size="sm"
                  disabled={isSaved}
                  onClick={() => void saveToHistory()}
                  icon={<Save size={14} />}
                >
                  {isSaved ? 'Saved' : 'Save to history'}
                </Button>
              </>
            )}
            {/* Calibration Mode toggle — authored timeline replaces model
                classification while face tracking stays live. */}
            <div
              className={cn(
                'flex h-11 items-center gap-2 rounded-lg border px-3 transition-colors duration-200 sm:h-9',
                isDemoMode
                  ? 'border-primary bg-primary-light'
                  : 'border-line bg-surface',
              )}
            >
              <Toggle
                isChecked={isDemoMode}
                onChange={setIsDemoMode}
                label="Calibration Mode"
              />
              <span className="hidden text-xs font-medium text-ink-2 md:inline">
                Calibration Mode
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="border border-line"
              onClick={cancelAndReset}
              icon={<FileVideo size={14} />}
            >
              New video
            </Button>
          </div>

          {isLongVideo && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-[#FFFBEB] px-3.5 py-2.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
              <p className="text-[13px] leading-snug text-[#B45309]">
                Long video detected. Processing may take several minutes — consider trimming to
                the relevant section.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* ── player ── */}
            <div className="md:col-span-7 lg:col-span-8">
              <div className="card overflow-hidden">
                <div className="relative flex items-center justify-center bg-[#0B1424]">
                  <div className="relative inline-block">
                    <video
                      ref={videoRef}
                      playsInline
                      className="block max-h-[520px] w-auto max-w-full"
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                      aria-label="Analyzed video"
                    />
                    {phase === 'ready' && (
                      <div className="pointer-events-none absolute inset-0">
                        {activeFaces.map((face) => (
                          <FaceMarker
                            key={face.id}
                            face={{
                              id: face.id,
                              dominant: face.dominant,
                              confidence: face.confidence,
                              age: face.age,
                              gender: face.gender,
                              status: face.status,
                              bornAt: 0,
                            }}
                            shouldAnimate={false}
                            style={{
                              left: `${face.x * 100}%`,
                              top: `${face.y * 100}%`,
                              width: `${face.width * 100}%`,
                              height: `${face.height * 100}%`,
                            }}
                            shouldShowAgeGender={shouldShowAgeGender}
                            isLabelBelow={face.y < 0.14}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Calibration Mode indicator — deliberately impossible to
                      miss: emotion data below is authored, not inferred. */}
                  {isDemoMode && (
                    <div className="absolute inset-x-0 top-0 z-30 flex justify-center p-3">
                      <span className="chip border border-primary bg-primary-light/95 text-primary-deep shadow-sm backdrop-blur-sm">
                        <FlaskConical size={12} />
                        Calibration Mode — emotion data is authored, not AI-inferred
                      </span>
                    </div>
                  )}

                  {phase === 'processing' && (
                    <div className="absolute inset-0 grid place-items-center bg-[#0B1424]/85 px-6">
                      <div className="w-full max-w-sm text-center">
                        <p className="font-display text-base font-semibold text-white">
                          Analyzing video… {Math.round(percentDone)}%
                        </p>
                        <p className="mono-stat mt-1 text-xs text-slate-400">
                          Frame {progress.done} / {progress.total}
                          {progress.etaSec > 1 && ` · ~${formatDuration(progress.etaSec)} left`}
                        </p>
                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width: `${percentDone}%`,
                              transition: 'width 300ms ease-out',
                            }}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-4 border border-white/20 text-slate-200 hover:bg-white/10 hover:text-white"
                          onClick={cancelAndReset}
                          icon={<X size={14} />}
                        >
                          Cancel
                        </Button>
                        <p className="mt-3 text-[11px] text-slate-500">
                          You can switch tabs — processing continues in the background.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* transport */}
                <div className="border-t border-line px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-white transition-colors hover:bg-primary-deep disabled:opacity-40"
                      onClick={togglePlay}
                      disabled={phase !== 'ready'}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={meta?.duration ?? 0}
                      step={0.05}
                      value={currentTime}
                      disabled={phase !== 'ready'}
                      onChange={(event) => seek(Number(event.target.value))}
                      aria-label="Seek video"
                      className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-primary disabled:opacity-50"
                    />
                    <span className="mono-stat shrink-0 text-xs text-ink-2">
                      {formatClock(currentTime)} / {formatClock(meta?.duration ?? 0)}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <div
                      className="flex rounded-lg border border-line bg-surface-alt p-0.5"
                      role="radiogroup"
                      aria-label="Playback speed"
                    >
                      {SPEEDS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          role="radio"
                          aria-checked={rate === speed}
                          disabled={phase !== 'ready'}
                          onClick={() => {
                            setRate(speed)
                            if (videoRef.current) videoRef.current.playbackRate = speed
                          }}
                          className={cn(
                            'mono-stat h-7 rounded-md px-2.5 text-[11px] font-medium transition-all duration-200',
                            rate === speed
                              ? 'bg-surface text-primary shadow-sm'
                              : 'text-ink-2 hover:text-ink',
                          )}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                    <span className="chip mono-stat bg-surface-alt text-[11px] text-ink-2">
                      Frame {frameIndex + 1} / {frames.length || 0}
                    </span>
                    <span className="chip mono-stat bg-surface-alt text-[11px] text-ink-2">
                      <Users size={11} /> {activeFaces.length}
                    </span>
                    <span className="mono-stat ml-auto hidden text-[11px] text-ink-3 sm:block">
                      sampled @ {sampleFps} FPS · on-device
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── comparison + breakdown panels ── */}
            <div className="space-y-4 md:col-span-5 lg:col-span-4">
              {analytics.people.length >= 2 && analytics.sharedFrames > 0 && (
                <div className="card p-4">
                  <SectionTitle
                    right={
                      <span
                        className={cn(
                          'chip px-2 py-0.5 text-[10px] font-semibold',
                          TONE_CLASSES[getSynchronyLabel(analytics.synchrony).tone],
                        )}
                      >
                        {getSynchronyLabel(analytics.synchrony).text}
                      </span>
                    }
                  >
                    Synchrony score
                  </SectionTitle>
                  <div className="flex items-center gap-3">
                    <span className="mono-stat font-display text-2xl font-bold text-accent">
                      {formatPercent(analytics.synchrony)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-alt">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-300"
                          style={{ width: formatPercent(analytics.synchrony) }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-ink-2">
                        Same emotion across{' '}
                        <span className="mono-stat font-semibold text-ink">
                          {(analytics.sharedFrames / sampleFps).toFixed(1)}s
                        </span>{' '}
                        of shared screen time.
                      </p>
                    </div>
                  </div>

                  {analytics.mirrors.length > 0 && (
                    <div className="mt-3.5 border-t border-line pt-3">
                      <p className="panel-title mb-2">Mirroring · {analytics.mirrors.length}</p>
                      <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                        {analytics.mirrors.map((event) => (
                          <div
                            key={event.id}
                            className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-1.5"
                          >
                            <Repeat2 size={12} className="shrink-0 text-accent" />
                            <span className="mono-stat shrink-0 text-[11px] text-ink-3">
                              {formatClock(event.t)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                              <span className="mono-stat font-semibold">P{event.leaderId}</span>
                              <span className="text-ink-2"> → </span>
                              <span className="mono-stat font-semibold">P{event.followerId}</span>{' '}
                              <span style={{ color: EMOTION_META[event.emotion].color }}>
                                {EMOTION_META[event.emotion].label}
                              </span>
                            </span>
                            <span className="mono-stat shrink-0 text-[10px] text-ink-3">
                              {event.delaySec.toFixed(1)}s
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="card p-4">
                <SectionTitle
                  right={
                    <span className="mono-stat text-[11px] text-ink-3">
                      {analytics.people.length}
                    </span>
                  }
                >
                  {analytics.people.length > 1 ? 'Comparison' : 'People'}
                </SectionTitle>
                {analytics.people.length === 0 ? (
                  <p className="py-4 text-center text-xs text-ink-3">
                    {phase === 'processing'
                      ? 'Detecting people…'
                      : 'No faces detected in this video'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {analytics.people.map((person) => {
                      const liveFace = activeFaces.find((face) => face.id === person.id)
                      const shown = liveFace?.dominant ?? person.dominant
                      return (
                        <div
                          key={person.id}
                          className={cn(
                            'rounded-lg border px-3 py-2.5 transition-colors duration-200',
                            liveFace
                              ? 'border-primary/40 bg-primary-light/20'
                              : 'border-line bg-surface',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <PersonBadge id={person.id} />
                            <EmotionIcon emotion={shown} size={15} />
                            <span className="truncate text-xs font-semibold text-ink">
                              {EMOTION_META[shown].label}
                            </span>
                            <span className="mono-stat ml-auto shrink-0 text-[11px] text-ink-3">
                              {formatDuration(person.presenceSec)}
                            </span>
                          </div>
                          {shouldShowAgeGender && (person.gender || person.age !== null) && (
                            <p className="mt-1 truncate text-[11px] text-ink-2">
                              {person.gender && (
                                <span className="capitalize">{person.gender}</span>
                              )}
                              {person.gender && person.age !== null && (
                                <span className="text-ink-3"> · </span>
                              )}
                              {person.age !== null && (
                                <span className="mono-stat">~{Math.round(person.age)}</span>
                              )}
                            </p>
                          )}
                          <div className="mt-2 space-y-1">
                            {EMOTIONS.filter((emotion) => person.distribution[emotion] > 0)
                              .sort((a, b) => person.distribution[b] - person.distribution[a])
                              .slice(0, 3)
                              .map((emotion) => (
                                <div key={emotion} className="flex items-center gap-2">
                                  <span className="w-14 shrink-0 truncate text-[11px] text-ink-2">
                                    {EMOTION_META[emotion].label}
                                  </span>
                                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-alt">
                                    <span
                                      className="block h-full rounded-full"
                                      style={{
                                        width: `${Math.round((person.distribution[emotion] / Math.max(0.001, person.presenceSec)) * 100)}%`,
                                        background: EMOTION_META[emotion].color,
                                      }}
                                    />
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {phase === 'ready' && activeFaces.length > 0 && (
                <div className="card p-4">
                  <SectionTitle
                    right={
                      <span className="mono-stat text-[11px] text-ink-3">
                        {formatClock(currentTime)}
                      </span>
                    }
                  >
                    At this moment
                  </SectionTitle>
                  {(() => {
                    const primary = getPrimaryVideoFace(frames[frameIndex])
                    if (!primary) return null
                    return <EmotionBars scores={primary.expressions} dominant={primary.dominant} />
                  })()}
                </div>
              )}
            </div>

            {/* ── timeline ── */}
            <div className="card p-4 sm:p-5 md:col-span-12">
              <SectionTitle
                right={
                  <span className="text-[11px] tracking-normal normal-case text-ink-3">
                    click to seek
                  </span>
                }
              >
                Emotion timeline · full video
              </SectionTitle>
              <EmotionTimeline
                samples={analytics.timeline}
                heightClassName="chart-box-tall"
                playheadT={phase === 'ready' ? currentTime : undefined}
                onSeek={phase === 'ready' ? seek : undefined}
                idleHint={phase === 'processing' ? 'Building timeline…' : 'No faces detected'}
              />
            </div>

            {/* ── summary ── */}
            {phase === 'ready' && (
              <div className="card p-4 sm:p-5 md:col-span-12">
                <SectionTitle>Analysis summary</SectionTitle>
                <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[1fr_auto]">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatTile label="Duration" value={formatClock(meta?.duration ?? 0)} />
                    <StatTile label="People" value={String(analytics.people.length)} />
                    <StatTile label="Transitions" value={String(transitions.length)} />
                    <StatTile
                      label={analytics.people.length >= 2 ? 'Mirroring' : 'Avg intensity'}
                      value={
                        analytics.people.length >= 2
                          ? String(analytics.mirrors.length)
                          : formatPercent(analytics.avgIntensity)
                      }
                    />
                  </div>
                  <div className="justify-self-center lg:justify-self-end">
                    <EmotionDonut distribution={analytics.distribution} size={150} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
