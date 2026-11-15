/**
 * FaceOverlay — HUD brackets + label badges positioned over a video/image.
 *
 * Pure presentation: it receives already-smoothed boxes and maps them into
 * the container's coordinate space. Because it uses absolutely-positioned
 * DOM elements (not a canvas), there is no previous frame to clear and
 * therefore no flicker; React reconciles positions in place.
 */
import { UserRound, UserRoundCog } from 'lucide-react'
import type { CSSProperties } from 'react'
import { EMOTION_META } from '@/utils/constants'
import { formatAge, formatGender, formatPercent } from '@/utils/formatters'
import { mapBoxToContainer, mapOrientedBoxToContainer } from '@/utils/geometry'
import { HUD_BRACKET_RATIO } from '@/utils/constants'
import type { Emotion } from '@/types/emotion'
import type { Gender, TrackStatus, TrackedFace } from '@/types/face'
import { cn } from '@/utils/cn'

export interface FaceMarkerModel {
  id: number
  dominant: Emotion
  confidence: number
  age: number | null
  gender: Gender | null
  status: TrackStatus
  bornAt: number
  /** Top probability fell below the confidence floor. */
  isLowConfidence?: boolean
}

export function FaceMarker({
  face,
  style,
  shouldShowAgeGender,
  isLabelBelow,
  shouldAnimate = true,
  rotation = 0,
}: {
  face: FaceMarkerModel
  style: CSSProperties
  shouldShowAgeGender: boolean
  isLabelBelow: boolean
  shouldAnimate?: boolean
  /** Head-roll rotation in radians; 0 or omitted renders axis-aligned. */
  rotation?: number
}) {
  const meta = EMOTION_META[face.dominant]
  const isNew = shouldAnimate && performance.now() - face.bornAt < 260
  const gender = formatGender(face.gender)
  const age = formatAge(face.age)
  const hasSecondaryLine = shouldShowAgeGender && (gender !== null || age !== null)

  const GenderIcon = face.gender === 'female' ? UserRoundCog : UserRound

  /*
   * Bracket arms scale with the box so a distant face gets proportionally
   * smaller corners instead of brackets that nearly meet. Clamped so they
   * stay visible at extreme distances and don't dominate a close-up.
   */
  const boxWidth = typeof style.width === 'number' ? style.width : 0
  const boxHeight = typeof style.height === 'number' ? style.height : 0
  const armLength = Math.max(10, Math.min(36, Math.min(boxWidth, boxHeight) * HUD_BRACKET_RATIO))
  const armStyle: CSSProperties = { width: armLength, height: armLength }

  return (
    <div
      className={cn(
        'absolute',
        isNew && 'face-enter',
        face.status === 'expiring' && 'face-exit',
        face.status === 'occluded' && 'face-occluded',
      )}
      style={
        {
          ...style,
          color: meta.color,
          /*
           * Rotation is applied via CSS transform rather than a canvas
           * redraw: the compositor animates it on the GPU at native
           * refresh rate with no per-frame JavaScript, and the badge
           * stays real DOM text (selectable, screen-reader readable,
           * crisply hinted).
           *
           * The angle also goes into a custom property so the entrance
           * keyframes can compose with it instead of clobbering it.
           */
          '--face-rotation': `${rotation}rad`,
          transform: rotation ? `rotate(${rotation}rad)` : undefined,
          transformOrigin: 'center center',
        } as CSSProperties
      }
    >
      <span className="fc fc-tl" style={armStyle} />
      <span className="fc fc-tr" style={armStyle} />
      <span className="fc fc-bl" style={armStyle} />
      <span className="fc fc-br" style={armStyle} />

      <span
        className={cn(
          'face-pill absolute left-1/2 flex flex-col gap-0.5 rounded-lg border bg-white/95 px-2.5 py-1 whitespace-nowrap backdrop-blur-sm',
          isLabelBelow ? 'top-1.5' : hasSecondaryLine ? '-top-[52px]' : '-top-9',
        )}
        style={{
          borderColor: `${meta.color}66`,
          /*
           * The badge orbits with the box (it is a child, so it stays
           * anchored above the top edge) but counter-rotates so the text
           * itself stays horizontal — a label tilted 25° is markedly
           * harder to read, and legibility beats stylistic consistency.
           */
          transform: rotation
            ? `translateX(-50%) rotate(${-rotation}rad)`
            : 'translateX(-50%)',
        }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'grid h-3.5 min-w-3.5 place-items-center rounded-full px-1 text-[9px] font-bold text-white',
              isNew && 'id-pop',
            )}
            style={{ background: meta.color }}
          >
            {face.id}
          </span>
          <span className="text-[12px] font-semibold text-ink">{meta.label}</span>
          {face.isLowConfidence ? (
            // Below the confidence floor the model is guessing, so the
            // percentage is withheld rather than presented as a fact.
            <span
              className="rounded-full bg-surface-alt px-1.5 text-[10px] font-medium text-ink-3"
              title="Low confidence — showing Neutral until the signal is clearer"
            >
              uncertain
            </span>
          ) : (
            <span className="mono-stat text-[11px] text-ink-2">
              {formatPercent(face.confidence)}
            </span>
          )}
        </span>
        {hasSecondaryLine && (
          <span className="flex items-center gap-1 text-[11px] font-normal text-ink-2">
            <GenderIcon size={11} className="text-ink-3" aria-hidden="true" />
            {gender && <span>{gender}</span>}
            {gender && age && <span className="text-ink-3">·</span>}
            {age && <span className="mono-stat">{age}</span>}
          </span>
        )}
      </span>
    </div>
  )
}

/** Overlay for a live video feed (object-fit: cover aware). */
export function FaceOverlay({
  faces,
  sourceWidth,
  sourceHeight,
  containerWidth,
  containerHeight,
  isMirrored,
  shouldShowAgeGender,
}: {
  faces: readonly TrackedFace[]
  sourceWidth: number
  sourceHeight: number
  containerWidth: number
  containerHeight: number
  isMirrored: boolean
  shouldShowAgeGender: boolean
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {faces.map((face) => {
        /*
         * Prefer the landmark-anchored oriented box: it hugs the facial
         * contour and tilts with head roll. Falls back to the detector's
         * axis-aligned box whenever landmarks are unavailable, so the
         * overlay never disappears just because the landmark net is off.
         */
        const oriented = face.orientedBox
          ? mapOrientedBoxToContainer(
              face.orientedBox,
              sourceWidth,
              sourceHeight,
              containerWidth,
              containerHeight,
              isMirrored,
            )
          : null
        const rendered =
          oriented ??
          mapBoxToContainer(
            face.box,
            sourceWidth,
            sourceHeight,
            containerWidth,
            containerHeight,
            isMirrored,
          )
        if (!rendered) return null
        return (
          <FaceMarker
            key={face.id}
            face={face}
            style={{
              left: rendered.left,
              top: rendered.top,
              width: rendered.width,
              height: rendered.height,
            }}
            rotation={oriented?.angle ?? 0}
            shouldShowAgeGender={shouldShowAgeGender}
            isLabelBelow={rendered.top < (shouldShowAgeGender ? 58 : 40)}
          />
        )
      })}
    </div>
  )
}
