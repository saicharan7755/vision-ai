/**
 * EmotionBars — horizontal intensity bars for every emotion in the enum.
 * Width transitions are CSS-driven (250ms ease-out) so values glide.
 */
import { memo } from 'react'
import { EMOTIONS, type Emotion, type EmotionScores } from '@/types/emotion'
import { EMOTION_META } from '@/utils/constants'
import { clamp } from '@/utils/geometry'
import { cn } from '@/utils/cn'

export const EmotionBar = memo(function EmotionBar({
  emotion,
  value,
  isDominant = false,
}: {
  emotion: Emotion
  value: number
  isDominant?: boolean
}) {
  const meta = EMOTION_META[emotion]
  const percent = Math.round(clamp(value, 0, 1) * 100)
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'w-[64px] shrink-0 truncate text-xs',
          isDominant ? 'font-bold' : 'font-medium text-ink-2',
        )}
        style={isDominant ? { color: meta.color } : undefined}
      >
        {meta.label}
      </span>
      <div
        className={cn(
          'relative flex-1 overflow-hidden rounded-full bg-surface-alt',
          isDominant ? 'h-2.5' : 'h-2',
        )}
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${meta.label} intensity`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${percent}%`,
            background: meta.color,
            transition: 'width 250ms ease-out',
          }}
        />
      </div>
      <span
        className={cn(
          'mono-stat w-9 shrink-0 text-right text-xs',
          isDominant ? 'font-bold' : 'text-ink-2',
        )}
        style={isDominant ? { color: meta.color } : undefined}
      >
        {percent}%
      </span>
    </div>
  )
})

/**
 * Custom comparator: `scores` arrives as a fresh object on every publish, so
 * identity comparison would defeat memoization entirely. Compare the values
 * instead, quantized to half-percent steps — sub-threshold churn is invisible
 * (the bars have CSS transitions) and re-rendering for it is pure waste.
 */
function areEmotionBarsPropsEqual(
  prev: { scores: EmotionScores | null; dominant: Emotion | null },
  next: { scores: EmotionScores | null; dominant: Emotion | null },
): boolean {
  if (prev.dominant !== next.dominant) return false
  if (prev.scores === next.scores) return true
  if (!prev.scores || !next.scores) return false
  return EMOTIONS.every(
    (emotion) =>
      Math.round(prev.scores![emotion] * 200) === Math.round(next.scores![emotion] * 200),
  )
}

export const EmotionBars = memo(
  function EmotionBars({
    scores,
    dominant,
  }: {
    scores: EmotionScores | null
    dominant: Emotion | null
  }) {
    return (
      <div className="space-y-2">
        {EMOTIONS.map((emotion) => (
          <EmotionBar
            key={emotion}
            emotion={emotion}
            value={scores ? scores[emotion] : 0}
            isDominant={dominant === emotion}
          />
        ))}
      </div>
    )
  },
  areEmotionBarsPropsEqual,
)
