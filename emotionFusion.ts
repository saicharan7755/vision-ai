/**
 * emotionFusion.ts — pass-through classification stage.
 *
 * ── WHY THIS IS A PASS-THROUGH ────────────────────────────────────────
 *
 * This engine previously implemented a dual-engine ensemble: it blended CNN
 * probabilities with landmark-geometry confidence boosts and applied
 * "gating" that zeroed-out Happy and Angry when the face's geometry did not
 * corroborate them. That was the root cause of a severe output collapse in
 * which the system could only ever emit Neutral, Sad or Surprise:
 *
 *  • The gate rejected HAPPY (CNN > 0.70 without a smile) and ANGRY
 *    (CNN > 0.65 without a furrowed brow), transferring all of that
 *    probability mass to Neutral.
 *  • SAD and SURPRISE were never gated, so they passed through freely.
 *  • FEAR / DISGUST / CONTEMPT sat behind activation floors high enough
 *    that a real model rarely reaches them, so they collapsed to Neutral.
 *
 * The surviving set — {Neutral, Sad, Surprise} — is exactly the observed
 * symptom. That is not a coincidence: it is the direct arithmetic
 * consequence of overriding the model's own output.
 *
 * Classification is now the model's pure softmax, unmolested. Landmark
 * ratios are still computed and still attached to each face
 * (`DetectedFace.landmarkRatios`) — they remain available to the crop
 * debugger and to any future consumer — but they no longer alter scores.
 *
 * The class and its method signatures are preserved verbatim so that
 * `useFaceDetection` and `useVideoAnalysis` keep working unchanged.
 */
import type { EmotionScores } from '@/types/emotion'
import type { LandmarkRatios } from './landmarkEngine'

export interface FusionResult {
  /** Fused probability vector, normalized to sum to 1. */
  readonly scores: EmotionScores
  /** True when gating rejected the CNN's top pick. Always false now. */
  readonly wasRejected: boolean
  /** The geometric ratios used, when landmarks were available. */
  readonly ratios: LandmarkRatios | null
}

export class EmotionFusionEngine {
  /**
   * Return the CNN's softmax probabilities unchanged.
   *
   * Signature retained (including `ratios` and `nowMs`) so callers are
   * untouched; the parameters are simply no longer used for scoring.
   */
  fuse(
    _personId: number,
    cnnScores: EmotionScores,
    ratios: LandmarkRatios | null,
    _nowMs: number,
  ): FusionResult {
    return { scores: cnnScores, wasRejected: false, ratios }
  }

  /** No per-person state is needed; retained for API compatibility. */
  retainOnly(_ids: readonly number[]): void {
    /* intentionally empty */
  }

  /** Retained for API compatibility with the "Recalibrate" control. */
  recalibrate(_nowMs: number): void {
    /* intentionally empty */
  }

  reset(): void {
    /* intentionally empty */
  }
}
