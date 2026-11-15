/**
 * Reusable smoothing primitives.
 *
 * Raw per-frame model output is noisy in two different ways, so it needs two
 * different filters: geometry needs sub-pixel stability WITHOUT lag (an
 * alpha-beta filter predicts, then corrects), while categorical labels need
 * majority voting (mode over a rolling window) to stop flicker.
 */
import { Emotion, type EmotionScores } from '@/types/emotion'

/** Standard exponential moving average. */
export function ema(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha
}

/*
 * The constant-velocity Kalman filter now lives in kalmanFilter.ts. It is
 * re-exported here so existing imports keep resolving; this is the
 * canonical implementation, not a copy.
 */
export { MotionFilter } from './kalmanFilter'

/**
 * Most frequent emotion in a window; ties resolve to the most recent.
 * This is what stops the label oscillating when two emotions sit within a
 * couple of percent of each other (e.g. 52% Happy vs 48% Neutral).
 */
export function getMode(window: readonly Emotion[], fallback: Emotion): Emotion {
  if (window.length === 0) return fallback
  const counts = new Map<Emotion, number>()
  for (const value of window) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best = fallback
  let bestCount = 0
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const value = window[i]
    if (value === undefined) continue
    const count = counts.get(value) ?? 0
    if (count > bestCount) {
      bestCount = count
      best = value
    }
  }
  return best
}

/** Blend a full score map toward a new reading. */
export function smoothScores(
  previous: EmotionScores,
  next: EmotionScores,
  alpha: number,
): EmotionScores {
  const result = { ...previous }
  for (const key of Object.keys(result) as Emotion[]) {
    result[key] = ema(previous[key], next[key], alpha)
  }
  return result
}

/** Fixed-capacity ring buffer — prevents unbounded array growth. */
export function pushCapped<T>(list: T[], item: T, maxLength: number): T[] {
  const next = list.length >= maxLength ? list.slice(list.length - maxLength + 1) : list.slice()
  next.push(item)
  return next
}

/** Highest-scoring emotion in a vector, with its probability. */
export function argMaxScores(scores: EmotionScores): { emotion: Emotion; value: number } {
  let best = Emotion.Neutral
  let bestValue = -1
  for (const [key, value] of Object.entries(scores) as [Emotion, number][]) {
    if (value > bestValue) {
      bestValue = value
      best = key
    }
  }
  return { emotion: best, value: Math.max(0, bestValue) }
}

/*
 * Baseline / normalization math now lives in its own module. Re-exported
 * here so existing imports keep resolving — these are the canonical
 * implementations, not copies.
 */
export {
  normalizeProbabilityVector as normalizeScores,
  subtractRestingBaseline as subtractBaseline,
} from './calibration'
