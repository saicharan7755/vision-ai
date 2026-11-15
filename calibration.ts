/**
 * calibration.ts — resting-face baseline offset math.
 *
 * Many people have a neutral expression the model reads as mildly Sad or
 * Angry: naturally downturned lips, a heavy brow, or deep-set eyes that
 * shadow. A model trained on the population average will systematically
 * misclassify those faces at rest.
 *
 * The fix is per-person: capture what the model says about THIS face while
 * it is relaxed, then subtract a share of that vector from every later
 * reading. This recentres the classifier on the individual rather than the
 * training population.
 *
 * Only a fraction (BASELINE_SUBTRACT_RATIO, 40%) is removed — subtracting
 * all of it would erase genuine expressions of an emotion the user happens
 * to rest near, which is worse than the bias it fixes.
 */
import { EMOTIONS, type EmotionScores } from '@/types/emotion'
import { BASELINE_SUBTRACT_RATIO } from './constants'

/** Mean of a set of probability vectors (uniform weights). */
export function averageScoreVectors(
  samples: readonly EmotionScores[],
): EmotionScores {
  const result = createZeroed()
  if (samples.length === 0) return result
  for (const sample of samples) {
    for (const emotion of EMOTIONS) result[emotion] += sample[emotion]
  }
  const count = samples.length
  for (const emotion of EMOTIONS) result[emotion] /= count
  return result
}

/** A zeroed, complete score map. */
function createZeroed(): EmotionScores {
  const result = {} as EmotionScores
  for (const emotion of EMOTIONS) result[emotion] = 0
  return result
}

/**
 * Remove a share of a person's resting-face bias from a reading.
 *
 * @param scores   Current raw probability vector.
 * @param baseline Captured resting-face vector.
 * @param ratio    Share of the baseline to subtract (0–1). Defaults to the
 *                 configured 40%.
 * @returns A re-normalized vector with the bias removed.
 */
export function subtractRestingBaseline(
  scores: EmotionScores,
  baseline: EmotionScores,
  ratio: number = BASELINE_SUBTRACT_RATIO,
): EmotionScores {
  const result = { ...scores }
  for (const emotion of EMOTIONS) {
    result[emotion] = Math.max(0, result[emotion] - baseline[emotion] * ratio)
  }
  return normalizeProbabilityVector(result)
}

/**
 * Rescale a vector so its components sum to 1 (no-op on an empty vector).
 * Keeps the output a valid probability distribution, which the downstream
 * hysteresis thresholds depend on.
 */
export function normalizeProbabilityVector(scores: EmotionScores): EmotionScores {
  let total = 0
  for (const emotion of EMOTIONS) total += scores[emotion]
  if (total <= 0) return scores
  const result = { ...scores }
  for (const emotion of EMOTIONS) result[emotion] = result[emotion] / total
  return result
}
