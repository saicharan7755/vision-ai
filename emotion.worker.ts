/**
 * emotion.worker.ts — HSEemotion ONNX inference off the main thread.
 *
 * Receives an aligned 224×224 face crop as a TRANSFERABLE ImageBitmap
 * (zero copy), converts it to a normalized NCHW tensor, runs the ONNX
 * session and posts the softmax'd 8-class vector back. The main thread
 * never touches a model tensor.
 *
 * Two environment constraints shaped this design:
 *
 *  1. This app builds to a single inlined HTML file, so the worker is
 *     imported via Vite's `?worker&inline` (base64 blob). Statically
 *     importing onnxruntime here would base64 ~600 KB of runtime into the
 *     bundle for a feature that is inactive without the model file.
 *     Instead the worker imports ort from a version-pinned CDN at runtime —
 *     zero bundle cost when unused, same-version guarantee when active.
 *
 *  2. The WASM execution provider is used rather than WebGL: WebGL in a
 *     worker depends on transferable OffscreenCanvas GL contexts, which
 *     remain flaky across browsers. WASM in a worker is ort-web's
 *     best-supported path, and being off the main thread is the point.
 */
import { Emotion, createEmptyScores, type EmotionScores } from '@/types/emotion'
import type { EmotionWorkerRequest, EmotionWorkerResponse } from './emotionWorkerProtocol'
import { ORT_CDN_BASE, ORT_MODULE_URL } from './emotionWorkerProtocol'

type OrtModule = typeof import('onnxruntime-web/wasm')
type OrtSession = import('onnxruntime-web/wasm').InferenceSession

/** Minimal worker-scope typing (the DOM lib has no DedicatedWorkerGlobalScope). */
interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: EmotionWorkerResponse, transfer?: Transferable[]): void
  close(): void
}
const ctx = self as unknown as WorkerScope

const INPUT_SIZE = 224
const PLANE = INPUT_SIZE * INPUT_SIZE
const TENSOR_LENGTH = PLANE * 3

/**
 * TENSOR SPEC (audited against the model's training recipe — do not change
 * any of these values without re-verifying against the HSEemotion source):
 *
 *  Layout   NCHW [1, 3, 224, 224] — planar: all R, then all G, then all B.
 *           Canvas getImageData yields RGBA; alpha is DROPPED in the loop
 *           below (indices pixel, pixel+1, pixel+2 only).
 *  Order    RGB. PyTorch/ONNX ImageNet models take RGB; no BGR swap.
 *  Norm     r' = (r/255 − 0.485) / 0.229
 *           g' = (g/255 − 0.456) / 0.224
 *           b' = (b/255 − 0.406) / 0.225
 */
const MEAN_R = 0.485
const MEAN_G = 0.456
const MEAN_B = 0.406
const STD_R = 0.229
const STD_G = 0.224
const STD_B = 0.225

/**
 * Logit index → emotion, in the exact AffectNet / HSEmotion ONNX order
 * (audited per the diagnostics directive):
 *
 *   Index 0 → Neutral    Index 4 → Fear
 *   Index 1 → Happy      Index 5 → Disgust
 *   Index 2 → Sad        Index 6 → Angry
 *   Index 3 → Surprise   Index 7 → Contempt
 *
 * Reordering this array silently permutes every prediction.
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

let ort: OrtModule | null = null
let session: OrtSession | null = null
let inputName = 'input'
let outputName = 'output'
/**
 * Single NCHW scratch buffer. The worker is single-threaded and handles
 * one classification at a time, so a ring (like the main-thread engine
 * needed) would be pointless here.
 */
const scratch = new Float32Array(TENSOR_LENGTH)

function post(message: EmotionWorkerResponse): void {
  ctx.postMessage(message)
}

/** Numerically stable softmax over logits. */
function softmax(logits: Float32Array): number[] {
  let max = -Infinity
  for (let i = 0; i < logits.length; i += 1) {
    const value = logits[i] ?? -Infinity
    if (value > max) max = value
  }
  const exponentials: number[] = []
  let sum = 0
  for (let i = 0; i < logits.length; i += 1) {
    const exponential = Math.exp((logits[i] ?? 0) - max)
    exponentials.push(exponential)
    sum += exponential
  }
  if (sum <= 0) return exponentials.map(() => 1 / logits.length)
  return exponentials.map((exponential) => exponential / sum)
}

/**
 * Structural self-test: a zero tensor must produce an 8-length vector of
 * finite logits. Catches a wrong or corrupt model file (e.g. a 5-class
 * variant) at init instead of emitting permuted emotions at runtime.
 */
async function verifyModel(): Promise<boolean> {
  if (!session || !ort) return false
  const zeros = new ort.Tensor('float32', new Float32Array(TENSOR_LENGTH), [
    1,
    3,
    INPUT_SIZE,
    INPUT_SIZE,
  ])
  const results = await session.run({ [inputName]: zeros })
  const output = results[outputName]
  if (!output) return false
  const logits = output.data as Float32Array
  if (logits.length !== AFFECTNET_ORDER.length) return false
  for (let i = 0; i < logits.length; i += 1) {
    if (!Number.isFinite(logits[i])) return false
  }
  return true
}

async function initialize(modelPath: string): Promise<void> {
  // The main thread probes the file first, but re-check here: the worker
  // is the component that actually pays for a bad URL.
  try {
    const probe = await fetch(modelPath, { method: 'HEAD' })
    if (!probe.ok) {
      post({ type: 'unavailable', reason: `model not found at ${modelPath}` })
      return
    }
  } catch {
    post({ type: 'unavailable', reason: 'model probe failed' })
    return
  }

  try {
    // Absolute-URL dynamic imports resolve correctly from a blob worker;
    // @vite-ignore keeps the bundler from trying to inline the CDN module.
    const runtime = (await import(/* @vite-ignore */ ORT_MODULE_URL)) as OrtModule
    ort = runtime
    runtime.env.wasm.wasmPaths = ORT_CDN_BASE
    if ((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== true) {
      // SharedArrayBuffer needs cross-origin isolation most hosts don't set.
      runtime.env.wasm.numThreads = 1
    }

    // ['webgl', 'wasm']: ORT tries providers in order and falls back to
    // the next when one fails to initialize — GPU acceleration where the
    // worker context allows it (OffscreenCanvas WebGL), WASM everywhere
    // else. Either way the session is cached for the page lifetime.
    session = await runtime.InferenceSession.create(modelPath, {
      executionProviders: ['webgl', 'wasm'],
    })
    inputName = session.inputNames[0] ?? 'input'
    outputName = session.outputNames[0] ?? 'output'

    if (!(await verifyModel())) {
      await session.release().catch(() => undefined)
      session = null
      post({ type: 'unavailable', reason: 'model failed verification (wrong output shape)' })
      return
    }
    post({ type: 'ready' })
  } catch (error) {
    console.error('[VISION AI worker] init failed', error)
    session = null
    post({ type: 'unavailable', reason: 'session creation failed' })
  }
}

async function classify(requestId: number, personId: number, bitmap: ImageBitmap): Promise<void> {
  if (!session || !ort) {
    bitmap.close()
    post({ type: 'error', requestId, message: 'engine not ready' })
    return
  }

  try {
    if (bitmap.width !== INPUT_SIZE || bitmap.height !== INPUT_SIZE) {
      throw new Error(`unexpected bitmap size ${bitmap.width}×${bitmap.height}`)
    }

    const surface = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE)
    const context = surface.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!context) throw new Error('OffscreenCanvas 2D context unavailable')

    context.drawImage(bitmap, 0, 0)
    // The bitmap is fully consumed by the draw — release it immediately
    // rather than waiting for GC, per the memory-hygiene requirements.
    bitmap.close()

    const { data } = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)

    // RGBA → three normalized NCHW planes.
    for (let pixel = 0, offset = 0; pixel < data.length; pixel += 4, offset += 1) {
      scratch[offset] = ((data[pixel] ?? 0) / 255 - MEAN_R) / STD_R
      scratch[PLANE + offset] = ((data[pixel + 1] ?? 0) / 255 - MEAN_G) / STD_G
      scratch[PLANE * 2 + offset] = ((data[pixel + 2] ?? 0) / 255 - MEAN_B) / STD_B
    }

    const tensor = new ort.Tensor('float32', scratch, [1, 3, INPUT_SIZE, INPUT_SIZE])
    const results = await session.run({ [inputName]: tensor })
    const output = results[outputName]
    if (!output) throw new Error('model produced no output')

    const logits = output.data as Float32Array
    if (logits.length !== AFFECTNET_ORDER.length) {
      throw new Error(`expected 8 classes, got ${logits.length}`)
    }

    const probabilities = softmax(logits)
    const scores: EmotionScores = createEmptyScores()
    for (let index = 0; index < AFFECTNET_ORDER.length; index += 1) {
      const emotion = AFFECTNET_ORDER[index]
      if (emotion) scores[emotion] = probabilities[index] ?? 0
    }
    post({
      type: 'result',
      requestId,
      personId,
      scores,
      // Raw logits + softmax probabilities travel with every result for
      // the debug verification log.
      logits: Array.from(logits),
      probabilities,
    })
  } catch (error) {
    // The bitmap may not have been closed on the early-throw paths.
    try {
      bitmap.close()
    } catch {
      /* already closed */
    }
    console.error('[VISION AI worker] classify failed', error)
    post({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : 'classification failed',
    })
  }
}

ctx.onmessage = (event: MessageEvent) => {
  const message = event.data as EmotionWorkerRequest
  if (!message || typeof message !== 'object') return

  switch (message.type) {
    case 'init':
      void initialize(message.modelPath)
      break
    case 'classify':
      void classify(message.requestId, message.personId, message.bitmap)
      break
    case 'dispose':
      if (session) {
        void session.release().catch(() => undefined)
        session = null
      }
      break
    default:
      break
  }
}
