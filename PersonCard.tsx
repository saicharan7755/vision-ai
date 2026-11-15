/**
 * PersonCard — one row in the "Detected Persons" panel.
 * Selecting a row pins that person as the dashboard's primary subject.
 */
import { memo } from 'react'
import { EmotionIcon } from '@/components/shared/EmotionIcon'
import { PersonBadge } from '@/components/shared/Badge'
import { EMOTION_META } from '@/utils/constants'
import { formatAge, formatGender, formatPercent } from '@/utils/formatters'
import type { TrackedFace } from '@/types/face'
import { cn } from '@/utils/cn'

/**
 * Custom comparator: the `face` object is rebuilt on every publish (~30 Hz),
 * but only a handful of its fields affect this card. Re-render exclusively
 * on meaningful changes so a moving box never re-renders the list rows.
 */
function arePersonCardPropsEqual(
  prev: {
    face: TrackedFace
    isPinned: boolean
    shouldShowAgeGender: boolean
    onSelect: (id: number) => void
  },
  next: {
    face: TrackedFace
    isPinned: boolean
    shouldShowAgeGender: boolean
    onSelect: (id: number) => void
  },
): boolean {
  if (
    prev.isPinned !== next.isPinned ||
    prev.shouldShowAgeGender !== next.shouldShowAgeGender ||
    prev.onSelect !== next.onSelect
  ) {
    return false
  }
  const a = prev.face
  const b = next.face
  return (
    a.id === b.id &&
    a.dominant === b.dominant &&
    a.status === b.status &&
    a.gender === b.gender &&
    Math.round(a.confidence * 100) === Math.round(b.confidence * 100) &&
    Math.round(a.age ?? 0) === Math.round(b.age ?? 0)
  )
}

export const PersonCard = memo(function PersonCard({
  face,
  isPinned,
  shouldShowAgeGender,
  onSelect,
}: {
  face: TrackedFace
  isPinned: boolean
  shouldShowAgeGender: boolean
  onSelect: (id: number) => void
}) {
  const meta = EMOTION_META[face.dominant]
  const gender = formatGender(face.gender)
  const age = formatAge(face.age)
  const hasDemographics = shouldShowAgeGender && (gender !== null || age !== null)

  return (
    <button
      type="button"
      onClick={() => onSelect(face.id)}
      aria-pressed={isPinned}
      aria-label={`Pin person ${face.id} as the primary subject`}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-200',
        isPinned
          ? 'border-primary bg-primary-light/30 shadow-sm'
          : 'border-line bg-surface hover:border-primary/40',
      )}
    >
      <PersonBadge id={face.id} />
      <EmotionIcon emotion={face.dominant} size={15} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="w-[52px] truncate text-xs font-medium text-ink">{meta.label}</span>
          <span className="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-surface-alt">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: formatPercent(face.confidence),
                background: meta.color,
                transition: 'width 250ms ease-out',
              }}
            />
          </span>
          <span className="mono-stat w-8 shrink-0 text-right text-[11px] text-ink-2">
            {formatPercent(face.confidence)}
          </span>
        </span>
        {hasDemographics && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-2">
            {gender}
            {gender && age && <span className="text-ink-3"> · </span>}
            {age && <span className="mono-stat">{age}</span>}
          </span>
        )}
      </span>
    </button>
  )
}, arePersonCardPropsEqual)
