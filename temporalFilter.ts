/**
 * temporalFilter.ts
 *
 * Weighted-window smoothing of emotion probability vectors.
 *
 * A single frame of classifier output is noisy: a blink, a head turn or a
 * momentary shadow can spike one class for one frame. Averaging a short
 * window of recent readings removes those spikes while an exponential
 * weight keeps the result responsive to genuine expression changes.
 *
 * weight(i) = BASE^i, with i = 0 for the OLDEST reading in the window, so
 * the newest frame always carries the largest weight.
 *
 * Only real readings are pushed. The tiered scheduler skips the emotion
 * net on most frames; pushing a placeholder on those would make the window
 * span an inconsistent amount of wall-clock time.
 */
import { EMOTIONS, createEmptyScores, type Emotion, type EmotionScores } from '@/types/emotion'
import { TEMPORAL_WEIGHT_BASE, TEMPORAL_WINDOW_SIZE } from './constants'

/**
 * Precomputed weights, index 0 = oldest slot. Computed once rather than
 * per frame per person — this runs inside the inference loop.
 */
const WEIGHTS: readonly number[] = Array.from({ length: TEMPORAL_WINDOW_SIZE }, (_, index) =>
  Math.pow(TEMPORAL_WEIGHT_BASE, index),
)

/**
 * Effective lag of the filter, in readings.
 *
 * Useful for reasoning about end-to-end latency: multiply by the emotion
 * inference period to get the delay a genuine expression change incurs
 * before it dominates the smoothed vector.
 */
export const FILTER_LAG_FRAMES: number = (() => {
  let weighted = 0
  let total = 0
  for (let index = 0; index < TEMPORAL_WINDOW_SIZE; index += 1) {
    const weight = WEIGHTS[index] ?? 0
    // Distance from the newest slot.
    weighted += weight * (TEMPORAL_WINDOW_SIZE - 1 - index)
    total += weight
  }
  return total > 0 ? weighted / total : 0
})()

/** Rolling per-person history of raw probability vectors. */
export class TemporalEmotionFilter {
  private histories = new Map<number, EmotionScores[]>()

  /** Discard all history. */
  reset(): void {
    this.histories.clear()
  }

  /** Drop history for people who are no longer tracked. */
  retainOnly(ids: readonly number[]): void {
    const keep = new Set(ids)
    for (const id of [...this.histories.keys()]) {
      if (!keep.has(id)) this.histories.delete(id)
    }
  }

  /** True once a person has at least one reading on record. */
  has(personId: number): boolean {
    return (this.histories.get(personId)?.length ?? 0) > 0
  }

  /**
   * Add one reading and return the smoothed vector.
   *
   * @param personId Stable track id.
   * @param scores   Fresh raw probability vector from the classifier.
   * @returns The weighted average across the retained window.
   */
  push(personId: number, scores: EmotionScores): EmotionScores {
    let history = this.histories.get(personId)
    if (!history) {
      history = []
      this.histories.set(personId, history)
    }
    history.push({ ...scores })
    if (history.length > TEMPORAL_WINDOW_SIZE) history.shift()
    return this.average(history)
  }

  /**
   * Smoothed vector without adding a reading — used on frames where the
   * emotion net was skipped, so the label persists instead of decaying.
   */
  peek(personId: number): EmotionScores | null {
    const history = this.histories.get(personId)
    if (!history || history.length === 0) return null
    return this.average(history)
  }

  /**
   * Weighted mean across the window. A partially-filled window uses the
   * first `length` weights, which keeps the newest reading dominant from
   * the very first frame rather than under-weighting a short history.
   */
  private average(history: readonly EmotionScores[]): EmotionScores {
    const result = createEmptyScores()
    if (history.length === 0) return result

    let totalWeight = 0
    for (let index = 0; index < history.length; index += 1) {
      const entry = history[index]
      const weight = WEIGHTS[index] ?? 0
      if (!entry) continue
      totalWeight += weight
      for (const emotion of EMOTIONS) {
        result[emotion] += entry[emotion] * weight
      }
    }

    if (totalWeight <= 0) return result
    for (const emotion of EMOTIONS) {
      result[emotion] = result[emotion] / totalWeight
    }
    return result
  }
}

/** Highest-scoring emotion in a vector. */
export function topEmotion(scores: EmotionScores): { emotion: Emotion; value: number } {
  let best: Emotion = EMOTIONS[EMOTIONS.length - 1] ?? ('neutral' as Emotion)
  let bestValue = -1
  for (const emotion of EMOTIONS) {
    if (scores[emotion] > bestValue) {
      bestValue = scores[emotion]
      best = emotion
    }
  }
  return { emotion: best, value: Math.max(0, bestValue) }
}
