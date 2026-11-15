/**
 * hsemotionEngine.ts — main-thread client for the emotion inference worker.
 *
 * The public API is unchanged from the previous in-process implementation:
 * loadHseEmotionModel / isHseEmotionActive / classifyEmotionHse /
 * disableHseEmotion. Only the internals moved — every ONNX call now runs
 * inside src/workers/emotion.worker.ts, reached via transferable
 * ImageBitmaps, so model inference never blocks the UI thread.
 *
 * When the HSEemotion model file is absent (the default deployment), the
 * local probe fails fast and NO worker is even spawned — the caller falls
 * back to the built-in FER classifier and this module costs nothing.
 */
import EmotionWorker from '../workers/emotion.worker?worker&inline'
import type {
  EmotionWorkerRequest,
  EmotionWorkerResponse,
} from '../workers/emotionWorkerProtocol'
import { Emotion, createEmptyScores, type EmotionScores } from '@/types/emotion'
import { ANIMATED_TEMPERATURE } from '@/utils/constants'
import { topEmotion } from '@/utils/temporalFilter'
import { createThrottledLogger } from '@/utils/debugLog'
import { useSettingsStore } from '@/store/settingsStore'
import { EMOTION_MODEL_PATH } from '@/utils/constants'

/** Raw-logits debug output, throttled to ~1 Hz (see utils/debugLog). */
const logLogits = createThrottledLogger(1000)

/** Init handshake: model download + session creation + self-test. */
const INIT_TIMEOUT_MS = 30_000
/** Per-classification round trip; exceeded → treated as an engine failure. */
const CLASSIFY_TIMEOUT_MS = 5_000

interface PendingClassification {
  resolve: (scores: EmotionScores) => void
  reject: (error: Error) => void
  timer: number
}

let worker: Worker | null = null
let isReady = false
let isPermanentlyFailed = false
let loadPromise: Promise<boolean> | null = null
let initResolve: ((ok: boolean) => void) | null = null
let initTimer = 0
let nextRequestId = 1
const pending = new Map<number, PendingClassification>()

/**
 * Probe for the model file before spawning anything. A 404 surfaced through
 * session creation is a cryptic protobuf parse error; a HEAD check keeps
 * the console clean and the fallback instant.
 */
async function probeModelFile(url: string): Promise<boolean> {
  if (!url.startsWith('/')) return true // remote path: let the worker judge
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Logit index → emotion, in the exact AffectNet order the model emits.
 * Mirrors `AFFECTNET_ORDER` in emotion.worker.ts — the worker cannot export
 * to the main thread, so the mapping is declared in both places and must be
 * kept in sync. Reordering either silently permutes every prediction.
 */
const AFFECTNET_ORDER: readonly Emotion[] = [
  Emotion.Neutral, // 0
  Emotion.Happy, // 1
  Emotion.Sad, // 2
  Emotion.Surprised, // 3
  Emotion.Fearful, // 4
  Emotion.Disgusted, // 5
  Emotion.Angry, // 6
  Emotion.Contempt, // 7
]

/**
 * Temperature-scaled scores for animated-content mode.
 *
 * The worker already returns the raw logits alongside its softmax, so
 * sharpening can happen here on the main thread — which means the setting
 * applies immediately, with no worker re-initialisation. Mathematically
 * identical to running softmax(logits / T) inside the worker.
 *
 * When the mode is off, or the logits are missing, the worker's own
 * softmax is returned unchanged.
 */
function applyTemperature(
  message: Extract<EmotionWorkerResponse, { type: 'result' }>,
): EmotionScores {
  if (!useSettingsStore.getState().isAnimatedContent) return message.scores
  const logits = message.logits
  if (!logits || logits.length === 0) return message.scores

  // Numerically stable softmax over logits / T.
  const scaled = logits.map((value) => value / ANIMATED_TEMPERATURE)
  const max = Math.max(...scaled)
  const exponentials = scaled.map((value) => Math.exp(value - max))
  const sum = exponentials.reduce((acc, value) => acc + value, 0)
  if (sum <= 0) return message.scores

  const probabilities = exponentials.map((value) => value / sum)
  const scores = createEmptyScores()
  for (let index = 0; index < probabilities.length; index += 1) {
    // AffectNet order — same mapping the worker applies.
    const emotion = AFFECTNET_ORDER[index]
    if (emotion) scores[emotion] = probabilities[index] ?? 0
  }
  return scores
}

function handleWorkerMessage(event: MessageEvent): void {
  const message = event.data as EmotionWorkerResponse
  if (!message || typeof message !== 'object') return

  switch (message.type) {
    case 'ready': {
      isReady = true
      if (initResolve) initResolve(true)
      break
    }
    case 'unavailable': {
      console.info(`[VISION AI] HSEmotion engine unavailable: ${message.reason}`)
      if (initResolve) initResolve(false)
      terminateWorker()
      isPermanentlyFailed = true
      break
    }
    case 'result': {
      // Verification log for the index-mapping test: when the debugger is
      // enabled, raw AffectNet logits appear in the console with the
      // resolved argmax — a smile must show the highest value at Index 1.
      if (useSettingsStore.getState().shouldShowCropDebugger) {
        const best = topEmotion(message.scores)
        logLogits(() => {
          console.log(
            '[VISION AI] HSEmotion logits:',
            message.logits,
            'softmax:',
            message.probabilities,
            `→ ${best.emotion} (${Math.round(best.value * 100)}%)`,
          )
        })
      }
      const entry = pending.get(message.requestId)
      if (entry) {
        pending.delete(message.requestId)
        window.clearTimeout(entry.timer)
        entry.resolve(applyTemperature(message))
      }
      break
    }
    case 'error': {
      const entry = pending.get(message.requestId)
      if (entry) {
        pending.delete(message.requestId)
        window.clearTimeout(entry.timer)
        entry.reject(new Error(message.message))
      }
      break
    }
    default:
      break
  }
}

function terminateWorker(): void {
  // Reject any in-flight classifications so callers fall back immediately.
  for (const [, entry] of pending) {
    window.clearTimeout(entry.timer)
    entry.reject(new Error('emotion worker terminated'))
  }
  pending.clear()
  window.clearTimeout(initTimer)
  if (worker) {
    worker.terminate()
    worker = null
  }
  isReady = false
}

/**
 * Load the HSEemotion engine. Idempotent; resolves false when the model is
 * unavailable, missing or invalid, in which case the caller keeps the FER
 * fallback.
 *
 * @returns true when the worker reports the ONNX engine ready.
 */
export async function loadHseEmotionModel(): Promise<boolean> {
  if (isReady) return true
  if (isPermanentlyFailed) return false
  if (loadPromise) return loadPromise

  loadPromise = (async (): Promise<boolean> => {
    // Fast-fail without spawning a worker when the model file is absent.
    if (!(await probeModelFile(EMOTION_MODEL_PATH))) {
      isPermanentlyFailed = true
      console.info(
        `[VISION AI] HSEmotion model not found at ${EMOTION_MODEL_PATH} — using FER fallback`,
      )
      return false
    }

    worker = new EmotionWorker()
    worker.onmessage = handleWorkerMessage
    worker.onerror = (event) => {
      console.error('[VISION AI] emotion worker crashed', event.message ?? event)
      if (initResolve) initResolve(false)
      terminateWorker()
      isPermanentlyFailed = true
    }

    const initOk = await new Promise<boolean>((resolve) => {
      initResolve = resolve
      initTimer = window.setTimeout(() => {
        console.error('[VISION AI] emotion engine init timed out')
        resolve(false)
      }, INIT_TIMEOUT_MS)
      const request: EmotionWorkerRequest = { type: 'init', modelPath: EMOTION_MODEL_PATH }
      worker?.postMessage(request)
    })
    initResolve = null
    window.clearTimeout(initTimer)

    if (!initOk) {
      terminateWorker()
      isPermanentlyFailed = true
      return false
    }
    return true
  })().catch((error: unknown) => {
    console.error('[VISION AI] HSEemotion load failed', error)
    terminateWorker()
    isPermanentlyFailed = true
    return false
  })

  return loadPromise
}

/** True when the worker is live and the engine has passed verification. */
export function isHseEmotionActive(): boolean {
  return isReady && worker !== null
}

/** Permanently disable the engine and tear down the worker. */
export function disableHseEmotion(): void {
  if (!worker) return
  terminateWorker()
  isPermanentlyFailed = true
}

/** Tear down the worker (used by engine teardown — session may be reloaded). */
export function terminateHseEmotion(): void {
  terminateWorker()
}

/**
 * Classify one aligned 224×224 crop in the worker.
 *
 * The crop canvas is snapshotted into a TRANSFERABLE ImageBitmap — the
 * pixels move to the worker with zero copying, and because
 * createImageBitmap snapshots at call time, the main thread's pooled crop
 * canvas can immediately be reused for the next face.
 *
 * @returns Complete 8-class probability vector, or null when the engine is
 *          not active.
 */
export async function classifyEmotionHse(
  crop: HTMLCanvasElement,
  personId = 0,
): Promise<EmotionScores | null> {
  if (!isReady || !worker) return null

  const activeWorker = worker
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(crop)
  } catch (error) {
    console.error('[VISION AI] createImageBitmap failed', error)
    return null
  }

  const requestId = nextRequestId
  nextRequestId += 1

  return new Promise<EmotionScores | null>((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId)
      // A timeout counts as an engine failure so the caller's failure
      // counter can escalate to the FER fallback.
      resolve(null)
    }, CLASSIFY_TIMEOUT_MS)

    pending.set(requestId, {
      resolve: (scores) => resolve(scores),
      // Rejections (worker reported an error) also resolve null rather than
      // throwing, matching the previous in-process contract.
      reject: () => resolve(null),
      timer,
    })

    const request: EmotionWorkerRequest = {
      type: 'classify',
      requestId,
      personId,
      bitmap,
    }
    activeWorker.postMessage(request, [bitmap])
  })
}
