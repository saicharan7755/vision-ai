/**
 * Message protocol between the main thread and the emotion inference
 * worker. Shared by both sides so a malformed message is a compile error,
 * not a runtime surprise.
 */
import type { EmotionScores } from '@/types/emotion'

export type EmotionWorkerRequest =
  | { type: 'init'; modelPath: string }
  | { type: 'classify'; requestId: number; personId: number; bitmap: ImageBitmap }
  | { type: 'dispose' }

export type EmotionWorkerResponse =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: string }
  | {
      type: 'result'
      requestId: number
      personId: number
      scores: EmotionScores
      /**
       * Raw pre-softmax logits in AffectNet index order, plus the post-
       * softmax probabilities, attached so the main thread can log them
       * for the index-mapping verification test (smile → index 1 highest)
       * without a second round trip. Sixteen floats — negligible cost,
       * sent on every classification and ignored when the debugger is off.
       */
      logits: number[]
      probabilities: number[]
    }
  | { type: 'error'; requestId: number; message: string }

/** CDN build of onnxruntime-web, matched to the installed package version. */
export const ORT_VERSION = '1.20.1'
export const ORT_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`
/** The WASM-only ESM build: reliable inside workers (no GL context needed). */
export const ORT_MODULE_URL = `${ORT_CDN_BASE}ort.wasm.min.mjs`
