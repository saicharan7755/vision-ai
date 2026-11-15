/**
 * detectionEngine.ts
 *
 * Owns all ML model loading and inference: face detection, landmark
 * extraction, emotion classification and age/gender estimation. Isolates
 * the ML dependency from the rest of the application — nothing outside
 * this module imports the inference runtime.
 *
 * Pipeline shape (per call):
 *   full-res source ──┬─► inference canvas (downscaled) ─► detector ─► boxes
 *                     └─► facePreprocessor (padded, eye-levelled, contrast
 *                         corrected crop at full detail) ─► expression /
 *                         age-gender nets
 *
 * Detection runs on a small surface because the detector only needs to
 * localize; classification crops from the ORIGINAL frame because expression
 * detail is exactly what a downscale destroys.
 */
import {
  AGE_GENDER_INTERVAL,
  DETECTION_SCORE_THRESHOLD,
  EMOTION_FRAME_INTERVAL,
  MIN_FACE_FRAME_FRACTION,
  MIN_FACE_SIZE_PX,
  MODEL_PATH,
  OBB_FOREHEAD_EXTENSION,
  OBB_HEIGHT_MARGIN,
  OBB_WIDTH_MARGIN,
} from '@/utils/constants'
import { applyNMS, computeOrientedBox, type OrientedBox } from '@/utils/geometry'
import { getDetectorInputSize, getFaceCap, getInferenceWidth } from '@/utils/hardware'
import { createEmptyScores, isEmotion, type EmotionScores } from '@/types/emotion'
import type { BoundingBox, DetectedFace, Gender } from '@/types/face'
import type { DetectionQuality } from '@/types/settings'
import { prepareFaceCrop, releaseCropPool, type EyeCenters } from './facePreprocessor'
import { computeLandmarkRatios, type LandmarkRatios } from './landmarkEngine'
import { detectFacesMediaPipe, initFaceDetector } from './faceDetector'
import {
  classifyEmotionHse,
  disableHseEmotion,
  isHseEmotionActive,
  loadHseEmotionModel,
  terminateHseEmotion,
} from './hsemotionEngine'
import { notify } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import { topEmotion } from '@/utils/temporalFilter'
import { createThrottledLogger } from '@/utils/debugLog'

/** Debug output for the FER fallback path, throttled to ~1 Hz. */
const logFerScores = createThrottledLogger(1000)

type FaceApiModule = typeof import('@vladmandic/face-api')

/**
 * The bundled type definitions do not surface the backend-control portion
 * of the TensorFlow namespace, so it is narrowed explicitly here rather
 * than reached for with `any`.
 */
interface TensorFlowRuntime {
  env: () => { set: (flag: string, value: boolean) => void }
  setBackend: (name: string) => Promise<boolean>
  getBackend: () => string
  ready: () => Promise<void>
  memory: () => { numTensors: number }
}

function getRuntime(api: FaceApiModule): TensorFlowRuntime {
  return api.tf as unknown as TensorFlowRuntime
}

/** Shape of a face-api landmark set, narrowed to what we consume. */
interface LandmarkSet {
  getLeftEye?: () => Array<{ x: number; y: number }>
  getRightEye?: () => Array<{ x: number; y: number }>
  /** All 68 iBUG points — feeds the geometric verification engine. */
  positions?: Array<{ x: number; y: number }>
}

interface RawDetection {
  detection: {
    box: { x: number; y: number; width: number; height: number }
    score: number
  }
  landmarks?: LandmarkSet
}

/** Which classifier is answering emotion queries. */
export type EmotionEngineName = 'hsemotion' | 'fer' | 'none'

export interface EngineCapabilities {
  hasDetector: boolean
  hasEmotion: boolean
  hasAgeGender: boolean
  hasLandmarks: boolean
  emotionEngine: EmotionEngineName
}

export interface DetectionOptions {
  quality?: DetectionQuality
  maxFaces?: number
  /** Run the age/gender net on this frame (~10–20 ms per face). */
  withAgeGender?: boolean
  /** Run the expression net on this frame. Defaults to true. */
  withExpressions?: boolean
}

/** Backend actually in use after negotiation. */
export type InferenceBackend = 'webgl' | 'wasm' | 'cpu' | 'unknown'

const CDN_SOURCES: readonly string[] = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://justadudewhohacks.github.io/face-api.js/models',
]

let faceapi: FaceApiModule | null = null
let loadPromise: Promise<EngineCapabilities> | null = null
let activeBackend: InferenceBackend = 'unknown'
let capabilities: EngineCapabilities = {
  hasDetector: false,
  hasEmotion: false,
  hasAgeGender: false,
  hasLandmarks: false,
  emotionEngine: 'none',
}

/** Source that successfully provided the detector weights; used to lazily
 *  load the FER fallback if the ONNX engine fails at runtime. */
let loadedWeightSource: string | null = null
let hasNotifiedFerFallback = false

/** Reused downscale surface — allocating per frame would thrash the GC. */
let inferenceCanvas: HTMLCanvasElement | null = null
let luminanceCanvas: HTMLCanvasElement | null = null

export function getCapabilities(): EngineCapabilities {
  return capabilities
}

export function isEngineReady(): boolean {
  return capabilities.hasDetector
}

export function getActiveBackend(): InferenceBackend {
  return activeBackend
}

/**
 * Probe whether local weights exist before requesting them. `public/models/`
 * ships empty, and without this check every cold start logs a 404 for the
 * local manifest before falling back to the CDN.
 */
let localModelsProbe: Promise<boolean> | null = null
function probeLocalModels(): Promise<boolean> {
  if (!localModelsProbe) {
    localModelsProbe = (async () => {
      if (!MODEL_PATH.startsWith('/')) return true
      try {
        const response = await fetch(
          `${MODEL_PATH}/tiny_face_detector_model-weights_manifest.json`,
          { method: 'HEAD' },
        )
        return response.ok
      } catch {
        return false
      }
    })()
  }
  return localModelsProbe
}

/**
 * Negotiate a GPU backend. Live analytics on the CPU backend is unusable
 * (single-digit FPS), so WebGL is attempted first, WASM second, and the
 * caller is warned if we end up anywhere else.
 */
async function configureBackend(api: FaceApiModule): Promise<InferenceBackend> {
  const tf = getRuntime(api)
  try {
    tf.env().set('WEBGL_PACK', true)
    // Forcing ops onto the GPU avoids silent per-op CPU fallbacks that
    // stall the pipeline mid-frame.
    tf.env().set('WEBGL_CPU_FORWARD', false)
    await tf.setBackend('webgl')
    await tf.ready()
    if (tf.getBackend() === 'webgl') return 'webgl'
  } catch (error) {
    console.error('[VISION AI] WebGL backend unavailable', error)
  }

  try {
    await tf.setBackend('wasm')
    await tf.ready()
    if (tf.getBackend() === 'wasm') return 'wasm'
  } catch (error) {
    console.error('[VISION AI] WASM backend unavailable', error)
  }

  await tf.ready()
  const fallback = tf.getBackend()
  return fallback === 'cpu' ? 'cpu' : 'unknown'
}

/**
 * Load model weights and negotiate a backend. Idempotent and cached for the
 * page lifetime, so starting a second session never re-downloads anything.
 *
 * Degrades gracefully: the detector is mandatory, every other net is
 * best-effort so a partial failure costs a feature rather than the app.
 *
 * @param onProgress Receives 0–1 while weights download.
 * @returns The capability set that was actually achieved.
 */
export async function loadModels(
  onProgress?: (progress: number) => void,
): Promise<EngineCapabilities> {
  if (capabilities.hasDetector) return capabilities
  if (loadPromise) return loadPromise

  loadPromise = (async (): Promise<EngineCapabilities> => {
    onProgress?.(0.05)
    const api = await import('@vladmandic/face-api')
    faceapi = api
    onProgress?.(0.2)

    activeBackend = await configureBackend(api)
    onProgress?.(0.3)

    let detectorLoaded = false
    let lastError: unknown = null
    const hasLocalWeights = await probeLocalModels()
    const sources = hasLocalWeights ? [MODEL_PATH, ...CDN_SOURCES] : CDN_SOURCES

    for (const source of sources) {
      try {
        await api.nets.tinyFaceDetector.loadFromUri(source)
        detectorLoaded = true
        loadedWeightSource = source
        onProgress?.(0.5)

        // Landmarks power eye-levelling. The tiny variant is ~80 KB and
        // costs about a millisecond, which the alignment gain repays.
        try {
          await api.nets.faceLandmark68TinyNet.loadFromUri(source)
          capabilities = { ...capabilities, hasLandmarks: true }
        } catch (error) {
          console.error('[VISION AI] landmark net unavailable', error)
        }
        onProgress?.(0.6)
        break
      } catch (error) {
        lastError = error
      }
    }

    if (!detectorLoaded) {
      loadPromise = null // allow an explicit retry
      console.error('[VISION AI] all weight sources failed', lastError)
      throw new Error('AI model failed to load. Please refresh the page.')
    }

    /*
     * ── MediaPipe FaceLandmarker (primary detector) ──
     *
     * Initialized in parallel with the emotion engine below. It never blocks
     * startup: a failure here simply leaves the face-api detector (loaded
     * above) as the active path, exactly as before this engine existed.
     */
    void initFaceDetector().then((ready) => {
      if (ready) {
        capabilities = { ...capabilities, hasLandmarks: true }
        console.info('[VISION AI] MediaPipe FaceLandmarker active (478-point mesh, GPU)')
      } else {
        console.info('[VISION AI] MediaPipe unavailable — using face-api detector fallback')
      }
    })

    // ── emotion engine selection ──
    // The HSEemotion AffectNet ONNX model (~87% accuracy) is preferred.
    // When its file is absent this resolves false almost instantly (one
    // HEAD request), and the FER2013 net loads as the fallback instead —
    // downloading both would waste ~300 KB on every fallback session.
    const weightSource = loadedWeightSource
    const hseLoaded = await loadHseEmotionModel()
    if (hseLoaded) {
      capabilities = { ...capabilities, hasEmotion: true, emotionEngine: 'hsemotion' }
    } else if (weightSource) {
      try {
        await api.nets.faceExpressionNet.loadFromUri(weightSource)
        capabilities = { ...capabilities, hasEmotion: true, emotionEngine: 'fer' }
        if (!hasNotifiedFerFallback) {
          hasNotifiedFerFallback = true
          notify(
            'info',
            'Emotion engine: FER2013 fallback',
            'Add enet_b0_8_best_afew.onnx to public/models/emotion/ to enable the 87% AffectNet model.',
          )
        }
      } catch (error) {
        console.error('[VISION AI] expression net unavailable', error)
      }
    }
    onProgress?.(0.9)

    // Age/gender only feeds an optional overlay, so it loads in the
    // background rather than delaying camera start.
    if (weightSource) {
      void api.nets.ageGenderNet
        .loadFromUri(weightSource)
        .then(() => {
          capabilities = { ...capabilities, hasAgeGender: true }
        })
        .catch((error: unknown) => {
          console.error('[VISION AI] age/gender net unavailable', error)
        })
    }

    capabilities = { ...capabilities, hasDetector: true }
    registerGpuLossListener()
    onProgress?.(1)
    return capabilities
  })().catch((error: unknown) => {
    loadPromise = null
    throw error
  })

  return loadPromise
}

/* ── WebGL context-loss recovery (Pillar 5.2) ────────────────────── */

/**
 * TF.js's detector runs on an internal WebGL canvas. When the OS drops
 * that context (tab suspension, GPU driver reset, memory pressure) every
 * subsequent op throws — and, critically, ALL model weights living in GPU
 * memory are gone. Recovery therefore means: pause, re-negotiate the
 * backend, and re-load the nets from the browser's HTTP cache (fast, no
 * network round trip in practice).
 */
let isGpuRecovering = false
let hasGpuLossListener = false
let gpuRecoveryAttempt = 0

/** True while the vision engine is rebuilding after a context loss. */
export function isEngineRecovering(): boolean {
  return isGpuRecovering
}

/**
 * Register the context-loss listener. webglcontextlost is a NON-BUBBLING
 * event fired at the canvas that owns the context — TF.js's internal canvas
 * — so only the CAPTURE phase on window can observe it.
 */
function registerGpuLossListener(): void {
  if (hasGpuLossListener || typeof window === 'undefined') return
  hasGpuLossListener = true
  window.addEventListener(
    'webglcontextlost',
    (event: Event) => {
      // The default behavior would try to restore the same dead context;
      // we rebuild the backend instead, so prevent it.
      event.preventDefault()
      void recoverFromGpuContextLoss()
    },
    true, // capture — required for non-bubbling canvas events
  )
}

/**
 * Rebuild the vision engine after GPU context loss. Debounced: a single
 * driver reset can fire the event several times, and only one rebuild
 * may run at a time.
 */
async function recoverFromGpuContextLoss(): Promise<void> {
  if (isGpuRecovering || !faceapi) return
  isGpuRecovering = true
  gpuRecoveryAttempt += 1
  notify('warning', 'Re-initializing GPU…', 'The graphics context was lost; restoring the vision engine.')

  try {
    const api = faceapi
    // Give the browser a moment to finish tearing the context down before
    // asking it for a new one.
    await new Promise((resolve) => setTimeout(resolve, 750))
    activeBackend = await configureBackend(api)

    const source = loadedWeightSource ?? CDN_SOURCES[0] ?? ''
    if (!source) throw new Error('no weight source available for recovery')

    await api.nets.tinyFaceDetector.loadFromUri(source)
    if (capabilities.hasLandmarks) {
      await api.nets.faceLandmark68TinyNet.loadFromUri(source).catch(() => undefined)
    }
    // The FER fallback net reloads only when it was actually in use.
    if (capabilities.emotionEngine === 'fer') {
      await api.nets.faceExpressionNet.loadFromUri(source).catch(() => undefined)
    }

    isGpuRecovering = false
    gpuRecoveryAttempt = 0
    notify('success', 'Vision engine restored', 'GPU analysis resumed automatically.')
  } catch (error) {
    console.error('[VISION AI] GPU recovery failed', error)
    // Back off and retry, capped — a permanently dead GPU should not loop.
    if (gpuRecoveryAttempt < 5) {
      isGpuRecovering = false
      window.setTimeout(() => void recoverFromGpuContextLoss(), 3000)
    } else {
      notify(
        'error',
        'GPU could not be restored',
        'Reload the page to restart the vision engine.',
      )
    }
  }
}

type InferenceSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

/** Consecutive ONNX failures before switching back to the FER engine. */
const HSE_MAX_CONSECUTIVE_FAILURES = 3
let hseFailureCount = 0

/**
 * Classify one aligned crop with whichever emotion engine is available.
 *
 * Preference order: HSEemotion ONNX (AffectNet, 8 classes) → FER2013 via
 * face-api. If the ONNX engine fails repeatedly at runtime (e.g. a WebGL
 * context lost mid-session) it is disabled and the FER net is loaded
 * on demand, so a crash in the better engine degrades accuracy rather
 * than taking the feature down.
 *
 * NOTE for the fallback path: face-api's toNetInput performs its own
 * normalization, so the crop must stay an ordinary 0–255 canvas there —
 * pre-normalizing would double-scale the tensor and wreck accuracy.
 */
async function classifyEmotionFromCrop(crop: HTMLCanvasElement): Promise<EmotionScores | null> {
  if (isHseEmotionActive()) {
    try {
      const scores = await classifyEmotionHse(crop)
      if (scores) {
        hseFailureCount = 0
        return scores
      }
      // A null return without a throw means the engine was inactive or the
      // crop shape was wrong — treat as a soft failure.
      hseFailureCount += 1
    } catch (error) {
      console.error('[VISION AI] HSEemotion inference failed', error)
      hseFailureCount += 1
    }
    if (hseFailureCount >= HSE_MAX_CONSECUTIVE_FAILURES) {
      disableHseEmotion()
      capabilities = { ...capabilities, emotionEngine: 'fer', hasEmotion: capabilities.hasEmotion }
      console.error('[VISION AI] HSEemotion disabled after repeated failures; falling back to FER')
      await ensureFerFallback()
      hseFailureCount = 0
    }
  }

  if (capabilities.hasEmotion && faceapi) {
    try {
      const prediction = await faceapi.nets.faceExpressionNet.predictExpressions(crop)
      const raw = Array.isArray(prediction) ? prediction[0] : prediction
      if (!raw) return null
      const expressions: EmotionScores = createEmptyScores()
      for (const [key, value] of Object.entries(raw as unknown as Record<string, unknown>)) {
        if (isEmotion(key) && typeof value === 'number') expressions[key] = value
      }
      // Same debug contract as the ONNX path: probability vector + argmax,
      // throttled, only while the crop debugger is enabled. (FER emits
      // post-softmax probabilities rather than raw logits.)
      if (useSettingsStore.getState().shouldShowCropDebugger) {
        const best = topEmotion(expressions)
        logFerScores(() => {
          console.log(
            '[VISION AI] FER2013 scores:',
            expressions,
            `→ ${best.emotion} (${Math.round(best.value * 100)}%)`,
          )
        })
      }
      return expressions
    } catch (error) {
      console.error('[VISION AI] expression inference failed', error)
      return null
    }
  }
  return null
}

/** Lazily load the FER net when the ONNX engine dies after startup. */
async function ensureFerFallback(): Promise<void> {
  if (capabilities.hasEmotion || !faceapi || !loadedWeightSource) return
  try {
    await faceapi.nets.faceExpressionNet.loadFromUri(loadedWeightSource)
    capabilities = { ...capabilities, hasEmotion: true, emotionEngine: 'fer' }
    notify(
      'warning',
      'Switched to fallback emotion model',
      'The high-accuracy model hit repeated errors; accuracy may be lower.',
    )
  } catch (error) {
    console.error('[VISION AI] loading FER fallback failed', error)
  }
}

/**
 * Shared per-face classification stage: crop, align, then run the emotion
 * and age/gender nets. Used by both detector paths so classification
 * behaviour can never drift between them.
 */
async function classifyFaces(
  source: InferenceSource,
  faces: readonly DetectedFace[],
  sourceWidth: number,
  sourceHeight: number,
  options: { withExpressions: boolean; withAgeGender: boolean },
): Promise<DetectedFace[]> {
  const shouldClassify = options.withExpressions && capabilities.hasEmotion
  const shouldEstimate = options.withAgeGender && capabilities.hasAgeGender
  if (!shouldClassify && !shouldEstimate) return [...faces]

  for (let index = 0; index < faces.length; index += 1) {
    const face = faces[index]
    if (!face) continue

    // Eye centres for crop levelling. MediaPipe carries its own pixel-space
    // mesh; the face-api path passes iBUG landmarks instead.
    const prepared = prepareFaceCrop(source, face.box, sourceWidth, sourceHeight, {
      slot: index,
      eyes: face.landmarks
        ? eyeCentersFromMesh(face.landmarks)
        : undefined,
    })
    if (!prepared) continue

    await classifyCrop(face, prepared, shouldClassify, shouldEstimate)
  }

  return [...faces]
}

/** Eye centres from a MediaPipe pixel-space mesh (33/133 and 362/263). */
function eyeCentersFromMesh(
  landmarks: readonly { x: number; y: number }[],
): EyeCenters | undefined {
  const rightOuter = landmarks[33]
  const rightInner = landmarks[133]
  const leftInner = landmarks[362]
  const leftOuter = landmarks[263]
  if (!rightOuter || !rightInner || !leftInner || !leftOuter) return undefined
  return {
    left: {
      x: (leftInner.x + leftOuter.x) / 2,
      y: (leftInner.y + leftOuter.y) / 2,
    },
    right: {
      x: (rightOuter.x + rightInner.x) / 2,
      y: (rightOuter.y + rightInner.y) / 2,
    },
  }
}

function getSourceSize(source: InferenceSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

/** Mean of a landmark point cluster. */
function centroid(points: Array<{ x: number; y: number }>): { x: number; y: number } | null {
  if (points.length === 0) return null
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: x / points.length, y: y / points.length }
}

/** Extract eye centres, scaled from inference space into source space. */
function readEyeCenters(landmarks: LandmarkSet | undefined, scale: number): EyeCenters | undefined {
  if (!landmarks?.getLeftEye || !landmarks.getRightEye) return undefined
  try {
    const left = centroid(landmarks.getLeftEye())
    const right = centroid(landmarks.getRightEye())
    if (!left || !right) return undefined
    return {
      left: { x: left.x * scale, y: left.y * scale },
      right: { x: right.x * scale, y: right.y * scale },
    }
  } catch {
    return undefined
  }
}

/**
 * Run one inference pass.
 *
 * Boxes are always returned in the ORIGINAL source coordinate space, so
 * callers never need to know that downscaling happened. `expressions` is
 * omitted on frames where the emotion net was skipped — callers reuse their
 * cached value rather than seeing a spurious all-zero vector.
 */
export async function detectFaces(
  source: InferenceSource,
  options: DetectionOptions = {},
): Promise<DetectedFace[]> {
  const api = faceapi
  if (!api || !capabilities.hasDetector) return []
  // While the GPU is rebuilding after a context loss, fail fast — each
  // attempt against a dead context would throw and pollute the log.
  if (isGpuRecovering) return []

  const { quality = 'auto', withAgeGender = false, withExpressions = true } = options
  const maxFaces = options.maxFaces ?? getFaceCap(quality)

  /*
   * ── PRIMARY PATH: MediaPipe FaceLandmarker ─────────────────────────
   *
   * Detection + 478-point mesh + head pose in ONE GPU pass. The mesh covers
   * the forehead (unlike iBUG-68), tracks irises, and yields a true 3D
   * transformation matrix. Already size-filtered and NMS-merged by
   * faceDetector, so this branch goes straight to classification.
   *
   * Returns null when MediaPipe is uninitialized or errored, in which case
   * control falls through to the face-api path below — the two-pass
   * TinyFaceDetector + 68-point landmark arrangement that preceded it.
   */
  if (source instanceof HTMLVideoElement) {
    const mediapipe = detectFacesMediaPipe(source, performance.now())
    if (mediapipe && !mediapipe.hadError && mediapipe.faces.length > 0) {
      return classifyFaces(source, mediapipe.faces, source.videoWidth, source.videoHeight, {
        withExpressions,
        withAgeGender,
      })
    }
    // Zero faces is a legitimate MediaPipe result (nobody in frame); only
    // an error means we should retry with the fallback.
    if (mediapipe && !mediapipe.hadError) return []
  }

  const { width: sourceWidth, height: sourceHeight } = getSourceSize(source)
  if (!sourceWidth || !sourceHeight) return []

  // ── stage 1: downscale onto the reusable inference canvas ──
  let surface: InferenceSource = source
  let scale = 1
  const targetWidth = getInferenceWidth(quality)
  if (sourceWidth > targetWidth) {
    scale = targetWidth / sourceWidth
    const width = Math.round(sourceWidth * scale)
    const height = Math.round(sourceHeight * scale)
    if (!inferenceCanvas) inferenceCanvas = document.createElement('canvas')
    if (inferenceCanvas.width !== width || inferenceCanvas.height !== height) {
      inferenceCanvas.width = width
      inferenceCanvas.height = height
    }
    const context = inferenceCanvas.getContext('2d', { alpha: false })
    if (context) {
      context.drawImage(source, 0, 0, width, height)
      surface = inferenceCanvas
    } else {
      scale = 1
    }
  }
  const inverseScale = scale === 0 ? 1 : 1 / scale

  // ── stage 2: detect (+ landmarks for alignment) ──
  const detectorOptions = new api.TinyFaceDetectorOptions({
    inputSize: getDetectorInputSize(quality),
    scoreThreshold: DETECTION_SCORE_THRESHOLD,
  })

  let results: RawDetection[]
  try {
    if (capabilities.hasLandmarks) {
      results = (await api
        .detectAllFaces(surface, detectorOptions)
        .withFaceLandmarks(true)) as unknown as RawDetection[]
    } else {
      const bare = await api.detectAllFaces(surface, detectorOptions)
      results = bare.map((detection) => ({
        detection: { box: detection.box, score: detection.score },
      }))
    }
  } catch (error) {
    console.error('[VISION AI] detection failed', error)
    return []
  }

  // Duplicate boxes on one face are a known detector artifact. Suppress
  // them here, before any expensive per-face classification runs.
  const geometry: Array<{ face: DetectedFace; landmarks?: LandmarkSet }> = results.map(
    (result) => {
      const box = result.detection.box
      const scaled: BoundingBox = {
        x: box.x * inverseScale,
        y: box.y * inverseScale,
        width: box.width * inverseScale,
        height: box.height * inverseScale,
      }
      // Engine 2: derive scale-invariant geometric ratios. Ratios need no
      // rescaling (each is normalized by another distance on the same
      // face), so they are computed in the detector's own coordinate space.
      const landmarkPositions = result.landmarks?.positions
      const computedRatios = landmarkPositions
        ? computeLandmarkRatios(landmarkPositions)
        : null
      const landmarkRatios: LandmarkRatios | undefined = computedRatios ?? undefined

      /*
       * Landmark-anchored oriented box for the HUD. Computed in detector
       * space then scaled: lengths scale linearly and the angle is
       * scale-invariant, so a uniform multiply is exact.
       */
      let orientedBox: OrientedBox | undefined
      if (landmarkPositions) {
        const obb = computeOrientedBox(
          landmarkPositions,
          OBB_WIDTH_MARGIN,
          OBB_HEIGHT_MARGIN,
          OBB_FOREHEAD_EXTENSION,
        )
        if (obb) {
          orientedBox = {
            centerX: obb.centerX * inverseScale,
            centerY: obb.centerY * inverseScale,
            width: obb.width * inverseScale,
            height: obb.height * inverseScale,
            angle: obb.angle,
          }
        }
      }

      return {
        face: {
          box: scaled,
          detectionScore: result.detection.score,
          landmarkRatios,
          orientedBox,
        },
        landmarks: result.landmarks,
      }
    },
  )

  /*
   * Minimum face size, enforced in SOURCE frame pixels so it is resolution
   * independent: each box must be both at least MIN_FACE_SIZE_PX on a side
   * and at least a fixed fraction of the frame width. Micro-detections
   * (background objects, shadows, necklines) are the dominant source of
   * phantom second faces that survive the score threshold — dropping them
   * here, before NMS, means one physical face can never yield a second box.
   */
  const minFaceSize = Math.max(MIN_FACE_SIZE_PX, sourceWidth * MIN_FACE_FRAME_FRACTION)
  const sizeFiltered: DetectedFace[] = []
  for (const entry of geometry) {
    const { width, height } = entry.face.box
    if (width >= minFaceSize && height >= minFaceSize) sizeFiltered.push(entry.face)
  }

  /*
   * Overlapping candidates on the same physical face are merged by IoU
   * non-maximum suppression (>= NMS_IOU_THRESHOLD overlap → the same
   * person, keep the higher-confidence box). Runs AFTER size filtering so
   * a big false box can't claim one of two real faces beside it.
   */
  const keptFaces = applyNMS(sizeFiltered)
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    .slice(0, maxFaces)

  // ── stage 3: per-face classification on aligned crops ──
  const shouldClassify = withExpressions && capabilities.hasEmotion
  const shouldEstimate = withAgeGender && capabilities.hasAgeGender
  if (!shouldClassify && !shouldEstimate) return keptFaces

  for (let index = 0; index < keptFaces.length; index += 1) {
    const face = keptFaces[index]
    if (!face) continue
    const landmarks = geometry.find((entry) => entry.face === face)?.landmarks

    /*
     * Eye centres come from iBUG landmark METHODS here (getLeftEye /
     * getRightEye) scaled out of detector space, rather than MediaPipe mesh
     * indices — the two models expose eyes differently, which is why crop
     * preparation stays per-path while the classification below is shared.
     */
    const prepared = prepareFaceCrop(source, face.box, sourceWidth, sourceHeight, {
      slot: index,
      eyes: readEyeCenters(landmarks, inverseScale),
    })
    if (!prepared) continue

    await classifyCrop(face, prepared, shouldClassify, shouldEstimate)
  }

  return keptFaces
}

/**
 * Shared post-crop classification: emotion + age/gender on an already
 * prepared, aligned crop.
 *
 * Extracted so the MediaPipe and face-api detector paths cannot drift apart
 * in classification behaviour — they differ only in how they produce the
 * crop (eye-centre extraction is model-specific), not in what happens next.
 */
async function classifyCrop(
  face: DetectedFace,
  prepared: { canvas: HTMLCanvasElement; luminance: number; wasEnhanced: boolean },
  shouldClassify: boolean,
  shouldEstimate: boolean,
): Promise<void> {
  face.luminance = prepared.luminance
  face.wasEnhanced = prepared.wasEnhanced

  if (shouldClassify) {
    const scores = await classifyEmotionFromCrop(prepared.canvas)
    if (scores) face.expressions = scores
  }

  if (!shouldEstimate) return

  try {
    const estimate = await faceapi!.nets.ageGenderNet.predictAgeAndGender(prepared.canvas)
    const single = Array.isArray(estimate) ? estimate[0] : estimate
    if (!single) return
    if (typeof single.age === 'number') face.age = single.age
    if (single.gender === 'male' || single.gender === 'female') {
      face.gender = single.gender as Gender
      face.genderProbability = single.genderProbability ?? 0.5
    }
  } catch (error) {
    console.error('[VISION AI] age/gender inference failed', error)
  }
}

/** True when this frame index should also run the age/gender net. */
export function shouldRunAgeGender(frameIndex: number): boolean {
  return frameIndex % AGE_GENDER_INTERVAL === 0
}

/** True when this frame index should run the emotion classifier. */
export function shouldRunExpressions(frameIndex: number): boolean {
  return frameIndex % EMOTION_FRAME_INTERVAL === 0
}

/** Mean relative luminance of the whole frame, 0..1. */
export function measureLuminance(video: HTMLVideoElement): number {
  try {
    if (!video.videoWidth) return 1
    if (!luminanceCanvas) {
      luminanceCanvas = document.createElement('canvas')
      luminanceCanvas.width = 48
      luminanceCanvas.height = 27
    }
    const context = luminanceCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) return 1
    context.drawImage(video, 0, 0, 48, 27)
    const { data } = context.getImageData(0, 0, 48, 27)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
    }
    return sum / (data.length / 4) / 255
  } catch {
    return 1
  }
}

/** Live tensor count — used to assert the loop is leak-free. */
export function getTensorCount(): number {
  try {
    return faceapi ? getRuntime(faceapi).memory().numTensors : 0
  } catch {
    return 0
  }
}

/**
 * Release every cached surface. Call when live analysis stops; the model
 * weights themselves are intentionally retained so restarting a session
 * does not re-download or re-compile shaders.
 */
export function releaseInferenceSurfaces(): void {
  if (inferenceCanvas) {
    inferenceCanvas.width = 0
    inferenceCanvas.height = 0
    inferenceCanvas = null
  }
  if (luminanceCanvas) {
    luminanceCanvas.width = 0
    luminanceCanvas.height = 0
    luminanceCanvas = null
  }
  releaseCropPool()
  // Also tears down the emotion inference worker (Step 4 hygiene).
  terminateHseEmotion()
}
