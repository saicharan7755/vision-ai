/**
 * useFaceDetection — the three decoupled loops of the live pipeline.
 *
 *  LOOP 1 — RENDER (rAF, display rate): advances tracked boxes by their
 *  velocity (coasting) and publishes to React on a tiered schedule
 *  (faces ~30 Hz, stats 10 Hz, timeline 2 Hz). It is NEVER gated by
 *  inference: if a detection pass takes 50 ms, the overlay keeps gliding.
 *
 *  LOOP 2 — INFERENCE: synchronized to CAMERA FRAME DELIVERY via
 *  requestVideoFrameCallback when available (Safari 15.4+, Chrome 83+) —
 *  never the display rate — so identical frames are never processed twice.
 *  Falls back to the render loop's clock where the API is missing. A
 *  budget from the adaptive preset plus a re-entrancy guard bounds the
 *  rate; a slow pass queues nothing behind itself.
 *
 *  LOOP 3 — REACT SYNC: handled inside Loop 1's throttles. Detection may
 *  run at 10–30 Hz, but the store is only written at the rates the UI can
 *  actually resolve.
 *
 * Also measures end-to-end inference latency (EMA, quantized to 5 ms) for
 * the diagnostics overlay.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  detectFaces,
  measureLuminance,
  releaseInferenceSurfaces,
  shouldRunAgeGender,
  shouldRunExpressions,
} from '@/services/detectionEngine'
import {
  ComparisonAnalyzer,
  EmotionAnalyzer,
  EmotionStabilizer,
  createSnapshot,
} from '@/services/emotionAnalyzer'
import { EmotionFusionEngine } from '@/services/emotionFusion'
import { FaceTracker } from '@/services/faceTracker'
import { setContrastEqualizationEnabled } from '@/services/facePreprocessor'
import { sendEmotionReading } from '@/services/arduinoSerial'
import { useAppStore } from '@/store/appStore'
import { useSessionStore } from '@/store/sessionStore'
import type { TrackedFace } from '@/types/face'
import type { DetectionQuality } from '@/types/settings'
import {
  DETECTION_FPS,
  FACES_UPDATE_MS,
  LOW_LIGHT_THRESHOLD,
  UI_UPDATE_MS,
} from '@/utils/constants'
import { getFaceCap, getPerformancePreset } from '@/utils/hardware'

interface UseFaceDetectionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  isEnabled: boolean
  quality: DetectionQuality
  shouldDetectAgeGender: boolean
}

export interface UseFaceDetectionResult {
  /** Whole-frame luminance is below the warning threshold. */
  isLowLight: boolean
  /** Contrast equalization is actively correcting the face crops. */
  isContrastEnhanced: boolean
  /** Recapture every tracked person's resting-face baseline. */
  recalibrate: () => void
}

/** Latency EMA smoothing factor. */
const LATENCY_EMA_ALPHA = 0.2

export function useFaceDetection({
  videoRef,
  isEnabled,
  quality,
  shouldDetectAgeGender,
}: UseFaceDetectionOptions): UseFaceDetectionResult {
  const [isLowLight, setIsLowLight] = useState(false)
  const [isContrastEnhanced, setIsContrastEnhanced] = useState(false)
  // Held in a ref so the Recalibrate button can reach the live instance
  // without restarting the loop (a restart would reset the session).
  const stabilizerRef = useRef<EmotionStabilizer | null>(null)
  const fusionRef = useRef<EmotionFusionEngine | null>(null)

  // Read the latest settings inside the loop without restarting it — a
  // restart would reset the session recorder mid-session.
  const ageGenderRef = useRef(shouldDetectAgeGender)
  ageGenderRef.current = shouldDetectAgeGender
  const qualityRef = useRef(quality)
  qualityRef.current = quality

  useEffect(() => {
    if (!isEnabled) {
      setIsLowLight(false)
      return
    }

    // The adaptive preset resolves the detection budget and the CLAHE
    // switch; an explicit quality choice overrides the width/inputs in the
    // engine but keeps the preset's timing and face cap.
    const preset = getPerformancePreset()
    setContrastEqualizationEnabled(preset.enableCLAHE)

    const tracker = new FaceTracker(getFaceCap(qualityRef.current))
    const emotionAnalyzer = new EmotionAnalyzer()
    const comparisonAnalyzer = new ComparisonAnalyzer()
    const stabilizer = new EmotionStabilizer()
    stabilizerRef.current = stabilizer
    const fusion = new EmotionFusionEngine()

    /**
     * Apply temporal stabilization on top of the tracker's raw geometry.
     * On coast frames `hasFreshScores` is false, so each person's locked
     * label and smoothed vector are replayed unchanged — the overlay keeps
     * moving without the emotion flickering between inference passes.
     */
    const stabilize = (faces: TrackedFace[], nowMs: number, hasFreshScores: boolean) => {
      stabilizer.retainOnly(faces.map((face) => face.id))
      fusion.retainOnly(faces.map((face) => face.id))
      return faces.map((face) => {
        /*
         * DUAL-ENGINE ENSEMBLE — fuse Engine 1 (CNN probabilities) with
         * Engine 2 (landmark geometry) before temporal stabilization.
         *
         * Fusion happens first because it needs the raw per-frame CNN
         * vector: the temporal window would otherwise average away the very
         * spikes the geometric gate is trying to inspect. Fusion runs even
         * on coast frames so the geometric evidence stays live, but with
         * hasFreshScores=false the CNN side is absent and fusion simply
         * returns the last smoothed vector (below).
         */
        let cnnScores = face.expressions
        if (hasFreshScores && face.status === 'active' && face.expressions) {
          const fused = fusion.fuse(face.id, face.expressions, face.landmarkRatios, nowMs)
          cnnScores = fused.scores
        }

        const raw = hasFreshScores && face.status === 'active' ? cnnScores : null
        const result = stabilizer.update(face.id, raw, nowMs)
        return {
          ...face,
          expressions: result.scores,
          dominant: result.dominant,
          confidence: result.confidence,
          isLowConfidence: result.isLowConfidence,
        }
      })
    }
    const { setFps, setInferenceLatency } = useAppStore.getState()
    const sessionStore = useSessionStore.getState()

    let isDisposed = false
    let isBusy = false
    let rafHandle = 0
    let rvfcHandle = 0
    let frameIndex = 0
    let framesThisSecond = 0
    let lastFpsAt = performance.now()
    let lastPublishAt = 0
    let lastLuminanceAt = 0
    let lastSampleAt = 0
    let lastFacesPublishAt = 0
    let latestFaces: TrackedFace[] = []
    let latencyEmaMs = -1
    // Session clock uses the monotonic timer; mixing it with Date.now()
    // would produce nonsensical timestamps.
    const startedAtPerf = performance.now()

    // 'auto' follows the preset's budget; an explicit quality keeps the
    // configured DETECTION_FPS clock.
    const detectionIntervalMs =
      qualityRef.current === 'auto'
        ? preset.detectionIntervalMs
        : 1000 / Math.max(1, DETECTION_FPS)
    let lastDetectionAt = 0

    const runDetection = async (nowMs: number): Promise<void> => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || video.videoWidth === 0) return

      // Tiered execution: the detector localizes every frame, but the
      // emotion net runs at half that rate and age/gender at a tenth —
      // their outputs simply do not change fast enough to justify the cost.
      const withExpressions = shouldRunExpressions(frameIndex)
      const inferenceStart = performance.now()
      const detections = await detectFaces(video, {
        quality: qualityRef.current,
        withExpressions,
        withAgeGender: ageGenderRef.current && shouldRunAgeGender(frameIndex),
      })
      const inferenceMs = performance.now() - inferenceStart
      if (isDisposed) return

      // Latency telemetry: EMA, then quantized to 5 ms steps so the store
      // write (and any re-render) only happens when the value meaningfully
      // moved — telemetry must not become its own re-render source.
      latencyEmaMs =
        latencyEmaMs < 0 ? inferenceMs : latencyEmaMs * (1 - LATENCY_EMA_ALPHA) + inferenceMs * LATENCY_EMA_ALPHA
      setInferenceLatency(Math.round(latencyEmaMs / 5) * 5)

      frameIndex += 1
      framesThisSecond += 1

      const elapsedSec = Math.max(0, (nowMs - startedAtPerf) / 1000)

      latestFaces = stabilize(tracker.update(detections, nowMs), nowMs, withExpressions)

      // Surface whether any visible face needed contrast correction.
      setIsContrastEnhanced(latestFaces.some((face) => face.wasEnhanced))

      // Drop analyzer state for retired tracks so nothing goes stale.
      emotionAnalyzer.retainOnly(latestFaces.map((face) => face.id))

      const transitions = emotionAnalyzer.process(latestFaces, nowMs, elapsedSec)
      comparisonAnalyzer.observe(latestFaces, elapsedSec)
      if (transitions.length > 0) {
        comparisonAnalyzer.noteTransitions(transitions)
        useSessionStore
          .getState()
          .addTransitions(transitions, comparisonAnalyzer.mirrorCount)
      }

      const departed = comparisonAnalyzer.departedPersonId
      if (departed !== null) {
        comparisonAnalyzer.departedPersonId = null
        useAppStore
          .getState()
          .pushToast('info', `P${departed} left the frame`, 'Comparison paused.')
      }

      // ── low-light check (~1 Hz, cheap but not free) ──
      if (nowMs - lastLuminanceAt > 900) {
        lastLuminanceAt = nowMs
        setIsLowLight(measureLuminance(video) < LOW_LIGHT_THRESHOLD)
      }

      if (nowMs - lastFpsAt >= 1000) {
        setFps(Math.round((framesThisSecond * 1000) / (nowMs - lastFpsAt)))
        framesThisSecond = 0
        lastFpsAt = nowMs
      }
    }

    /** Start a detection pass if the budget allows. */
    const maybeStartDetection = (nowMs: number): void => {
      if (isBusy || isDisposed) return
      if (nowMs - lastDetectionAt < detectionIntervalMs) return
      lastDetectionAt = nowMs
      isBusy = true
      void runDetection(nowMs)
        .catch((error: unknown) => {
          console.error('[VISION AI] detection frame failed', error)
        })
        .finally(() => {
          isBusy = false
        })
    }

    // ── LOOP 1: render — coasting + tiered publishing, never gated by ML ──
    const renderTick = (): void => {
      if (isDisposed) return
      rafHandle = requestAnimationFrame(renderTick)
      const nowMs = performance.now()

      // Coast between detections: advance boxes by velocity at display
      // rate, with no inference cost. Skipped while a pass is in flight so
      // the tracker's correction lands on unambiguous state.
      if (!isBusy) {
        latestFaces = stabilize(tracker.coast(nowMs), nowMs, false)
      }

      // Fallback inference trigger for browsers without the camera-frame
      // callback (below). With rVFC available, this is skipped entirely.
      if (!supportsCameraFrameCallback) maybeStartDetection(nowMs)

      // Tiered publishing: boxes at ~30 Hz for smooth motion; the heavier
      // stats/comparison panels and the 2 Hz timeline sampler run far less
      // often. This is what keeps React out of the inference hot path.
      if (nowMs - lastFacesPublishAt >= FACES_UPDATE_MS) {
        lastFacesPublishAt = nowMs
        useSessionStore.getState().publishFaces(latestFaces)
      }

      if (nowMs - lastPublishAt >= UI_UPDATE_MS) {
        lastPublishAt = nowMs
        const elapsedSec = Math.max(0, (nowMs - startedAtPerf) / 1000)
        useSessionStore.getState().publishFrame({
          faces: latestFaces,
          comparison: comparisonAnalyzer.getState(latestFaces),
          sessionT: elapsedSec,
        })

        // Hardware rig: stream the primary face's reading to the Arduino.
        // Called unconditionally — sendEmotionReading is a no-op unless the
        // link is up, and it owns its own 150 ms throttle, so this adds
        // nothing to the frame budget when no board is attached.
        const hardwareFace = latestFaces
          .filter((face) => face.status === 'active')
          .reduce<TrackedFace | null>(
            (largest, candidate) =>
              !largest || candidate.box.width * candidate.box.height > largest.box.width * largest.box.height
                ? candidate
                : largest,
            null,
          )
        if (hardwareFace) {
          sendEmotionReading(hardwareFace.dominant, hardwareFace.confidence)
        }
      }

      if (nowMs - lastSampleAt >= 500) {
        lastSampleAt = nowMs
        const elapsedSec = Math.max(0, (nowMs - startedAtPerf) / 1000)
        const activeFaces = latestFaces.filter((face) => face.status === 'active')
        comparisonAnalyzer.sample(latestFaces, elapsedSec)
        useSessionStore
          .getState()
          .recordSample(createSnapshot(activeFaces, elapsedSec), elapsedSec)
      }
    }

    // ── LOOP 2: inference — synchronized to camera frame delivery ──
    // requestVideoFrameCallback fires once per NEW camera frame, so the
    // engine never processes the same frame twice (a plain rAF clock can
    // fire twice between camera frames on a 60 Hz display + 30 Hz camera).
    const supportsCameraFrameCallback =
      typeof HTMLVideoElement !== 'undefined' &&
      'requestVideoFrameCallback' in HTMLVideoElement.prototype

    const scheduleCameraFrameDetection = (): void => {
      const video = videoRef.current
      if (isDisposed || !video || !supportsCameraFrameCallback) return
      rvfcHandle = video.requestVideoFrameCallback(() => {
        if (isDisposed) return
        maybeStartDetection(performance.now())
        scheduleCameraFrameDetection()
      })
    }

    sessionStore.startSession()
    rafHandle = requestAnimationFrame(renderTick)
    if (supportsCameraFrameCallback) scheduleCameraFrameDetection()

    return () => {
      isDisposed = true
      cancelAnimationFrame(rafHandle)
      if (supportsCameraFrameCallback && rvfcHandle !== 0) {
        videoRef.current?.cancelVideoFrameCallback(rvfcHandle)
      }
      tracker.reset()
      emotionAnalyzer.reset()
      comparisonAnalyzer.reset()
      stabilizer.reset()
      stabilizerRef.current = null
      fusion.reset()
      fusionRef.current = null
      latestFaces = []
      // Frees the crop pool, downscale surfaces AND terminates the emotion
      // worker. Model weights are deliberately retained so restarting a
      // session does not re-download them.
      releaseInferenceSurfaces()
      useAppStore.getState().setFps(0)
      useAppStore.getState().setInferenceLatency(0)
    }
    // Intentionally depends only on `isEnabled`: settings are read through
    // refs so toggling them never restarts the loop or the session.
  }, [isEnabled, videoRef])

  const recalibrate = useCallback(() => {
    stabilizerRef.current?.recalibrate(performance.now())
  }, [])

  return { isLowLight, isContrastEnhanced, recalibrate }
}
