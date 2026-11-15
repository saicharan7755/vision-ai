/**
 * EmotionHero — the large "current emotion" readout.
 */
import { Info } from 'lucide-react'
import { memo } from 'react'
import { EmotionIcon } from '@/components/shared/EmotionIcon'
import { ProgressRing } from '@/components/shared/Badge'
import { EMOTION_META } from '@/utils/constants'
import { formatAge, formatGender, formatPercent } from '@/utils/formatters'
import { Emotion } from '@/types/emotion'
import type { TrackedFace } from '@/types/face'

/** Accuracy disclosure for AI-estimated demographics. */
export function EstimateInfo() {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="grid h-3.5 w-3.5 place-items-center rounded-full text-ink-3 transition-colors hover:text-primary"
        aria-label="About age and gender estimation accuracy"
      >
        <Info size={11} />
      </button>
      <span className="card pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 p-2.5 text-[11px] leading-snug text-ink-2 opacity-0 shadow-pop transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100">
        Age &amp; gender are AI-generated estimates from facial features only, and may be
        inaccurate. Age is typically ±5–10 years; the model is binary and accuracy varies across
        ethnicities and age groups.
      </span>
    </span>
  )
}

/** Re-render only when a displayed value actually changes (see PersonCard). */
function areEmotionHeroPropsEqual(
  prev: { face: TrackedFace | null; shouldShowAgeGender: boolean },
  next: { face: TrackedFace | null; shouldShowAgeGender: boolean },
): boolean {
  if (prev.shouldShowAgeGender !== next.shouldShowAgeGender) return false
  const a = prev.face
  const b = next.face
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.dominant === b.dominant &&
    a.gender === b.gender &&
    Math.round(a.confidence * 100) === Math.round(b.confidence * 100) &&
    Math.round(a.age ?? 0) === Math.round(b.age ?? 0)
  )
}

export const EmotionHero = memo(
  function EmotionHero({
    face,
    shouldShowAgeGender,
  }: {
    face: TrackedFace | null
    shouldShowAgeGender: boolean
  }) {
  if (!face) {
    return (
      <div className="flex items-center gap-4 py-1.5">
        <span className="opacity-35">
          <EmotionIcon emotion={Emotion.Neutral} size={40} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-ink-3">Waiting for a face</p>
          <p className="text-xs text-ink-3">Analysis begins as soon as someone is visible.</p>
        </div>
      </div>
    )
  }

  const gender = formatGender(face.gender)
  const age = formatAge(face.age)
  const hasDemographics = shouldShowAgeGender && (gender !== null || age !== null)

  return (
    <div className="flex items-center gap-4">
      <EmotionIcon emotion={face.dominant} size={40} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate-safe font-display text-[28px] leading-none font-bold text-ink">
          {EMOTION_META[face.dominant].label}
        </p>
        <p className="mono-stat mt-1.5 text-base font-medium text-primary">
          {formatPercent(face.confidence)} confidence
        </p>
        {hasDemographics && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-2">
            {gender && <span>{gender}</span>}
            {gender && age && <span className="text-ink-3">·</span>}
            {age && <span className="mono-stat">{age}</span>}
            <EstimateInfo />
          </p>
        )}
      </div>
      <div className="text-center">
        <ProgressRing value={face.confidence} />
        <p className="mt-1 text-[10px] font-medium tracking-wide text-ink-3">CLARITY</p>
      </div>
    </div>
  )
},
areEmotionHeroPropsEqual)
