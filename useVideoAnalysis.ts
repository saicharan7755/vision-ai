/**
 * useVideoAnalysis — the Video tab's entire processing pipeline.
 *
 * Owns the frame-extraction loop ({video} seek → detect → track → analyze),
 * progress reporting, cancellation, and save/export. The page receives
 * ready-to-render frames, transitions and analytics — it never imports an
 * inference or storage service itself.
 *
 * Processing yields to the event loop between frames, so the UI stays
 * responseive and other tabs remain usable while a long video is analyzed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectFaces } from '@/services/detectionEngine'
import {
  EmotionAnalyzer,
  EmotionStabilizer,
  buildVideoAnalytics,
  getDistributionLeader,
  getSynchronyLabel,
} from '@/services/emotionAnalyzer'
import { EmotionFusionEngine } from '@/services/emotionFusion'
import { FaceTracker } from '@/services/faceTracker'
import { saveSession } from '@/services/sessionManager'
import { useModelLoader } from './useModelLoader'
import { buildCalibratedScores, getCalibratedEmotion, looksLikeDemoVideo } from '@/lib/demo/videoDemoScenario'
import { notify } from '@/store/appStore'
import { EMOTIONS, createEmptyScores, type Emotion, type TransitionEvent } from '@/types/emotion'
import type { TrackedFace, VideoAnalytics, VideoFrame } from '@/types/face'
import type { Session } from '@/types/session'
import {
  EMOTION_META,
  LONG_VIDEO_SEC,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_MB,
  VIDEO_SAMPLE_FPS,
} from '@/utils/constants'
import { createId, formatClock, formatDuration, formatPercent } from '@/utils/formatters'

/** Some browsers report an empty MIME type for .mov/.mkv, so the file
 * extension is used as the fallback for a video-looking file. */
const VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|mov|avi|mkv|m4v)$/i

export type VideoAnalysisPhase = 'idle' | 'processing' | 'ready'

export interface VideoMeta {
  name: string
  duration: number
  width: number
  height: number
}

export interface UseVideoAnalysisResult {
  phase: VideoAnalysisPhase
  meta: VideoMeta | null
  progress: { done: number; total: number; etaSec: number }
  isLongVideo: boolean
  /** Sampling rate used for the current video (10 / 5 / 3 by duration). */
  sampleFps: number
  /** Calibration Mode: authored timeline replaces model classification. */
  isDemoMode: boolean
  setIsDemoMode: (isEnabled: boolean) => void
  frames: VideoFrame[]
  transitions: TransitionEvent[]
  analytics: VideoAnalytics
  isSaved: boolean
  selectFile: (file: File) => Promise<void>
  cancelAndReset: () => void
  saveToHistory: () => Promise<void>
  exportReport: () => void
}

/**
 * Deterministically seek to a timestamp and resolve only once the frame is
 * actually decodable.
 *
 * Two failure modes make naive seeking corrupt ML input:
 *  1. Browsers fire `seeked` while the decoder is still producing the new
 *     frame, so an immediate drawImage captures the PREVIOUS frame's pixels.
 *  2. Near end-of-file some browsers never fire `seeked` at all.
 *
 * So: wait for `seeked`, then poll until `seeking === false` AND
 * `readyState >= 2` (HAVE_CURRENT_DATA). The watchdog timeout still
 * guarantees we terminate on a wedged decoder, but it resolves UNREADY —
 * callers check the boolean and skip inference rather than feeding the
 * model a half-decoded YUV frame.
 */
function seekTo(video: HTMLVideoElement, time: number): Promise<boolean> {
  return new Promise((resolve) => {
    let isSettled = false

    const finish = (isReady: boolean) => {
      if (isSettled) return
      isSettled = true
      video.removeEventListener('seeked', onSeeked)
      window.clearTimeout(watchdog)
      resolve(isReady)
    }

    /** Frame is only safe to sample once decoding has caught up. */
    const isDecodable = () => !video.seeking && video.readyState >= 2

    const onSeeked = () => {
      if (isDecodable()) {
        finish(true)
        return
      }
      // `seeked` fired before the frame was ready — poll for it.
      pollReady()
    }

    const pollReady = () => {
      if (isSettled) return
      if (isDecodable()) {
        finish(true)
        return
      }
      window.setTimeout(pollReady, 16)
    }

    // Watchdog: some browsers never emit `seeked` at end-of-file. Resolve
    // UNREADY so the caller skips the frame instead of drawing garbage.
    const watchdog = window.setTimeout(() => {
      finish(isDecodable())
    }, 1500)

    video.addEventListener('seeked', onSeeked)
    try {
      video.currentTime = time
    } catch {
      finish(false)
    }
  })
}

const yieldToEventLoop = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

export function useVideoAnalysis(
  getVideoElement: () => HTMLVideoElement | null,
): UseVideoAnalysisResult {
  const { ensureReady } = useModelLoader()
  const isCancelledRef = useRef(false)
  const urlRef = useRef<string | null>(null)

  const [phase, setPhase] = useState<VideoAnalysisPhase>('idle')
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0, etaSec: 0 })
  const [isLongVideo, setIsLongVideo] = useState(false)
  const [frames, setFrames] = useState<VideoFrame[]>([])
  const [transitions, setTransitions] = useState<TransitionEvent[]>([])
  const [isSaved, setIsSaved] = useState(false)
  /**
   * Sampling rate actually used for the current video. Exposed because the
   * player's scrubber converts playback time to a frame index with it — if
   * it assumed a fixed rate the overlays would desync from the picture.
   */
  const [sampleFps, setSampleFps] = useState(VIDEO_SAMPLE_FPS)
  /**
   * Calibration Mode: emotion scores come from the authored demo timeline
   * rather than the ONNX model. Face detection stays live either way.
   * Auto-enabled for demo-looking filenames; always user-togglable.
   */
  const [isDemoMode, setIsDemoMode] = useState(false)

  useEffect(() => {
    return () => {
      isCancelledRef.current = true
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  const cancelAndReset = useCallback(() => {
    isCancelledRef.current = true
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setPhase('idle')
    setFrames([])
    setTransitions([])
    setMeta(null)
    setIsSaved(false)
    setIsLongVideo(false)
  }, [])

  const selectFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/') && !VIDEO_EXTENSION_PATTERN.test(file.name)) {
        notify('warning', 'Unsupported format', 'Please use MP4, WEBM, or MOV.')
        return
      }
      if (file.size > MAX_VIDEO_BYTES) {
        notify('warning', 'File too large', `Maximum size is ${MAX_VIDEO_MB}MB.`)
        return
      }

      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const url = URL.createObjectURL(file)
      urlRef.current = url
      isCancelledRef.current = false

      // Auto-enable Calibration Mode for demo-looking filenames. The user
      // can toggle it off; the indicator stays visible either way.
      const autoDetected = looksLikeDemoVideo(file.name)
      setIsDemoMode(autoDetected)
      if (autoDetected) {
        notify(
          'info',
          'Calibration Mode enabled',
          'Emotion scores come from the authored demo timeline, not the AI model. Face tracking stays live.',
        )
      }
      setFrames([])
      setTransitions([])
      setIsSaved(false)
      setPhase('processing')
      setProgress({ done: 0, total: 0, etaSec: 0 })

      await yieldToEventLoop()
      const video = getVideoElement()
      if (!video) return
      video.src = url

      const isReadable = await new Promise<boolean>((resolve) => {
        const onLoaded = () => {
          cleanup()
          resolve(true)
        }
        const onError = () => {
          cleanup()
          resolve(false)
        }
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoaded)
          video.removeEventListener('error', onError)
        }
        video.addEventListener('loadedmetadata', onLoaded)
        video.addEventListener('error', onError)
        video.load()
      })

      if (!isReadable || !Number.isFinite(video.duration) || video.duration <= 0) {
        notify(
          'error',
          'Unsupported format',
          "This browser can't decode that file. Please use MP4 (H.264), WEBM, or MOV.",
        )
        cancelAndReset()
        return
      }

      const duration = video.duration
      const sourceWidth = video.videoWidth || 1
      const sourceHeight = video.videoHeight || 1
      setMeta({ name: file.name, duration, width: sourceWidth, height: sourceHeight })
      setIsLongVideo(duration > LONG_VIDEO_SEC)

      if (!(await ensureReady())) {
        cancelAndReset()
        return
      }

      /*
       * Dynamic sampling — a fixed rate wastes time on short clips and
       * loses temporal resolution on long ones.
       *   < 30 s   → 10 FPS (100 ms)  short social clips, fast expressions
       *   30 s–3 m →  5 FPS (200 ms)  standard
       *   > 3 m    →  3 FPS (333 ms)  talks/interviews, keeps runtime sane
       */
      const resolvedFps = duration < 30 ? 10 : duration < 180 ? 5 : 3
      setSampleFps(resolvedFps)

      const total = Math.max(1, Math.floor(duration * resolvedFps))
      setProgress({ done: 0, total, etaSec: 0 })

      const tracker = new FaceTracker()
      const emotionAnalyzer = new EmotionAnalyzer()
      const stabilizer = new EmotionStabilizer()
      const fusion = new EmotionFusionEngine()
      const collected: VideoFrame[] = []
      const collectedTransitions: TransitionEvent[] = []
      const startedAt = performance.now()

      // Snapshot so a mid-run toggle can't half-apply to one analysis.
      const isDemoActive = isDemoMode
      let previousDemoEmotion: Emotion | null = null

      for (let index = 0; index < total; index += 1) {
        if (isCancelledRef.current) return
        const time = index / sampleFps
        const isFrameReady = await seekTo(video, time)
        if (isCancelledRef.current) return

        // Undecodable frame (end-of-file watchdog or wedged decoder):
        // record an empty keyframe rather than feeding the model a stale
        // or half-decoded YUV buffer.
        if (!isFrameReady) {
          collected.push({ t: Math.round(time * 100) / 100, faces: [] })
          continue
        }

        try {
          const detections = await detectFaces(video, {
            quality: 'balanced',
            /*
             * Calibration Mode skips the emotion net entirely — MediaPipe
             * detection still runs so boxes, landmarks and head pose stay
             * live, but classification is replaced by the authored timeline,
             * so paying for ONNX inference would be wasted work.
             */
            withExpressions: !isDemoActive,
            withAgeGender: index % 3 === 0,
          })
          const tracked = tracker.update(detections, time * 1000)

          /*
           * FULL PIPELINE PARITY with the live camera path.
           *
           * Previously video analysis ran only the legacy mode-smoothing
           * analyzer, so uploaded videos were classified with raw CNN
           * scores — no geometric ensemble, no baseline-relative gating, no
           * per-class thresholds. That is exactly why a video could read a
           * resting face as Angry while the live feed read it Neutral.
           *
           * Video now runs the identical two-stage stack:
           *  1. Fusion — 0.65·CNN + 0.35·landmark-geometry, with the gate
           *     that rejects lighting false-positives.
           *  2. Stabilizer — weighted temporal window, per-class floors and
           *     hysteresis lock.
           *
           * `time * 1000` is used as the clock so the 1.5 s resting-baseline
           * capture and hysteresis windows run on VIDEO time, not wall time
           * — a 2× slow analysis doesn't stretch them.
           */
          let analyzed: TrackedFace[]

          if (isDemoActive) {
            /*
             * CALIBRATION MODE — authored scores, live geometry.
             *
             * Bypasses fusion/stabilizer entirely: hysteresis and the
             * temporal window would delay each authored transition by
             * several samples, defeating the point of a frame-accurate
             * timeline. Transitions are emitted exactly at segment
             * boundaries instead.
             */
            const segment = getCalibratedEmotion(time)
            const scores = buildCalibratedScores(segment)
            analyzed = tracked.map((face) => ({
              ...face,
              expressions: scores,
              dominant: segment.emotion,
              confidence: segment.confidence,
              isLowConfidence: false,
            }))

            const primaryId = analyzed[0]?.id ?? 1
            if (previousDemoEmotion !== null && previousDemoEmotion !== segment.emotion) {
              collectedTransitions.push({
                id: createId(),
                t: Math.round(time * 100) / 100,
                personId: primaryId,
                from: previousDemoEmotion,
                to: segment.emotion,
                speed: 'sudden',
              })
            }
            previousDemoEmotion = segment.emotion
          } else {
            /*
             * STANDARD PATH — full parity with the live camera.
             * Fusion (softmax pass-through) then stabilizer (temporal window,
             * floors, hysteresis). `time * 1000` is the clock so the
             * 1.5 s resting baseline and hysteresis windows run on VIDEO
             * time, not wall time.
             */
            fusion.retainOnly(tracked.map((face) => face.id))
            stabilizer.retainOnly(tracked.map((face) => face.id))
            emotionAnalyzer.retainOnly(tracked.map((face) => face.id))

            analyzed = tracked.map((face) => {
              const fused = fusion.fuse(
                face.id,
                face.expressions ?? createEmptyScores(),
                face.landmarkRatios,
                time * 1000,
              )
              const result = stabilizer.update(face.id, fused.scores, time * 1000)
              return {
                ...face,
                expressions: result.scores,
                dominant: result.dominant,
                confidence: result.confidence,
                isLowConfidence: result.isLowConfidence,
              }
            })

            collectedTransitions.push(...emotionAnalyzer.process(analyzed, time * 1000, time))
          }

          collected.push({
            t: Math.round(time * 100) / 100,
            faces: analyzed
              .filter((face) => face.status !== 'expiring')
              .map((face) => ({
                id: face.id,
                x: face.box.x / sourceWidth,
                y: face.box.y / sourceHeight,
                width: face.box.width / sourceWidth,
                height: face.box.height / sourceHeight,
                dominant: face.dominant,
                confidence: face.confidence,
                expressions: face.expressions,
                age: face.age,
                gender: face.gender,
                status: face.status,
              })),
          })
        } catch (error) {
          // A single bad frame must not abort a 10 minute analysis.
          console.error('[VISION AI] video frame failed', error)
          collected.push({ t: time, faces: [] })
        }

        if (index % 3 === 0 || index === total - 1) {
          const elapsed = performance.now() - startedAt
          const perFrame = elapsed / (index + 1)
          setProgress({ done: index + 1, total, etaSec: ((total - index - 1) * perFrame) / 1000 })
          await yieldToEventLoop()
        }
      }

      if (isCancelledRef.current) return
      setFrames(collected)
      setTransitions(collectedTransitions)
      // Rewind BEFORE enabling playback UI, otherwise the playhead briefly
      // renders at the end of the video before snapping back to 00:00.
      await seekTo(video, 0)
      if (isCancelledRef.current) return
      setPhase('ready')
      notify(
        'success',
        'Analysis complete',
        `${collected.length} frames · ${collectedTransitions.length} transitions`,
      )
    },
    [ensureReady, getVideoElement, cancelAndReset],
  )

  const analytics = useMemo(
    () => buildVideoAnalytics(frames, transitions, sampleFps),
    [frames, transitions, sampleFps],
  )

  const saveToHistory = useCallback(async () => {
    if (!meta || frames.length === 0) return
    const session: Session = {
      // Tag calibrated sessions so stored data is never mistaken for
      // real model inference.
      ...({ source: isDemoMode ? 'calibrated' : 'video' } as Pick<Session, 'source'>),
      id: createId(),
      startedAt: Date.now() - Math.round(meta.duration * 1000),
      endedAt: Date.now(),
      durationSec: meta.duration,
      peakFaces: analytics.peakFaces,
      dominantEmotion: getDistributionLeader(analytics.distribution),
      avgIntensity: analytics.avgIntensity,
      transitions,
      distribution: analytics.distribution,
      timeline: analytics.timeline.filter((_, index) => index % sampleFps === 0),
    }
    try {
      const result = await saveSession(session)
      setIsSaved(true)
      notify('success', 'Saved to history', `${meta.name} · ${formatDuration(meta.duration)}`)
      if (result.prunedCount > 0) {
        notify('info', 'Oldest session removed to free space', 'Storage keeps the most recent sessions only.')
      }
    } catch (error) {
      console.error('[VISION AI] saving video session failed', error)
      notify('error', "Couldn't save", 'Local storage is unavailable in this browser.')
    }
  }, [meta, frames.length, analytics, transitions, isDemoMode, sampleFps])

  const exportReport = useCallback(() => {
    if (!meta) return
    const leader = getDistributionLeader(analytics.distribution)
    const total = EMOTIONS.reduce((sum, emotion) => sum + analytics.distribution[emotion], 0) || 1
    const lines = [
      '# VISION AI — Video Analysis Report',
      '',
      `**File:** ${meta.name}`,
      `**Duration:** ${formatClock(meta.duration)}  ·  **Resolution:** ${meta.width}×${meta.height}`,
      `**Analyzed:** ${frames.length} frames @ ${sampleFps} FPS`,
      ...(isDemoMode
        ? ['**Mode:** CALIBRATION — emotion scores are authored, not model-inferred.']
        : []),
      `**Generated:** ${new Date().toLocaleString()}`,
      '',
      '## Summary',
      `- People detected: ${analytics.people.length}`,
      `- Peak simultaneous faces: ${analytics.peakFaces}`,
      `- Emotion transitions: ${transitions.length}`,
      `- Average intensity: ${formatPercent(analytics.avgIntensity)}`,
      `- Dominant emotion: ${EMOTION_META[leader].label}`,
      ...(analytics.people.length >= 2 && analytics.sharedFrames > 0
        ? [
            `- Emotional synchrony: ${formatPercent(analytics.synchrony)} (${getSynchronyLabel(analytics.synchrony).text})`,
            `- Mirroring events: ${analytics.mirrors.length}`,
          ]
        : []),
      '',
      '## Emotion distribution (primary subject)',
      ...EMOTIONS.map(
        (emotion) =>
          `- ${EMOTION_META[emotion].label}: ${Math.round((analytics.distribution[emotion] / total) * 100)}% (${analytics.distribution[emotion].toFixed(1)}s)`,
      ),
      '',
      '## People',
      ...analytics.people.flatMap((person) => [
        `### P${person.id}`,
        `- Dominant emotion: ${EMOTION_META[person.dominant].label}`,
        `- Screen time: ${formatDuration(person.presenceSec)}`,
        `- Average confidence: ${formatPercent(person.avgConfidence)}`,
        `- Estimated: ${person.gender ?? 'unknown'}${person.age !== null ? ` · ~${Math.round(person.age)} years` : ''} (AI estimate, ±5–10 years)`,
        '',
      ]),
      '## Transition log',
      ...(transitions.length > 0
        ? transitions.map(
            (event) =>
              `- ${formatClock(event.t)} · P${event.personId} · ${EMOTION_META[event.from].label} → ${EMOTION_META[event.to].label} (${event.speed})`,
          )
        : ['- No transitions detected']),
      '',
      '---',
      '_Processed entirely on-device by VISION AI. Age and gender are AI estimates and may be inaccurate._',
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${meta.name.replace(/\.\w+$/, '')}-vision-report.md`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    notify('success', 'Report exported', 'Markdown file downloaded.')
  }, [meta, analytics, frames.length, transitions, isDemoMode, sampleFps])

  return {
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
  }
}
