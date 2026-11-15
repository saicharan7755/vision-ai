/**
 * Bespoke SVG emotion glyphs — consistent line weight, brand colors,
 * no emoji font dependency.
 */
import { Emotion } from '@/types/emotion'
import { EMOTION_META } from '@/utils/constants'

export function EmotionIcon({
  emotion,
  size = 20,
  className,
}: {
  emotion: Emotion
  size?: number
  className?: string
}) {
  const color = EMOTION_META[emotion].color
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label={EMOTION_META[emotion].label}
    >
      {emotion === Emotion.Happy && (
        <>
          <circle cx="8.5" cy="9.6" r="1" fill={color} stroke="none" />
          <circle cx="15.5" cy="9.6" r="1" fill={color} stroke="none" />
          <path d="M7.5 13.4Q12 17.3 16.5 13.4" />
        </>
      )}
      {emotion === Emotion.Sad && (
        <>
          <circle cx="8.5" cy="10.6" r="1" fill={color} stroke="none" />
          <circle cx="15.5" cy="10.6" r="1" fill={color} stroke="none" />
          <path d="M7.7 16.4Q12 12.7 16.3 16.4" />
        </>
      )}
      {emotion === Emotion.Angry && (
        <>
          <path d="M6.9 7.6L10.5 9.6" />
          <path d="M17.1 7.6L13.5 9.6" />
          <circle cx="9.3" cy="11.6" r="0.9" fill={color} stroke="none" />
          <circle cx="14.7" cy="11.6" r="0.9" fill={color} stroke="none" />
          <path d="M8 16.6Q12 13.8 16 16.6" />
        </>
      )}
      {emotion === Emotion.Surprised && (
        <>
          <circle cx="8.5" cy="9.4" r="1" fill={color} stroke="none" />
          <circle cx="15.5" cy="9.4" r="1" fill={color} stroke="none" />
          <circle cx="12" cy="15.4" r="2.4" />
        </>
      )}
      {emotion === Emotion.Fearful && (
        <>
          <path d="M6.9 6.9Q8.9 5.9 10.9 6.9" />
          <path d="M13.1 6.9Q15.1 5.9 17.1 6.9" />
          <circle cx="8.6" cy="10.4" r="1.55" />
          <circle cx="15.4" cy="10.4" r="1.55" />
          <path d="M7.2 16Q9.2 14.4 11.2 16T15.2 16" />
        </>
      )}
      {emotion === Emotion.Disgusted && (
        <>
          <path d="M7 10Q8.6 11.2 10.2 10" />
          <path d="M13.8 10Q15.4 11.2 17 10" />
          <path d="M8 16Q10 14.8 12 15.8Q14.2 16.8 16 14.9" />
        </>
      )}
      {emotion === Emotion.Contempt && (
        // One-sided smirk: asymmetric brows and an off-centre mouth.
        <>
          <path d="M6.9 8.4L10.3 9.2" />
          <path d="M17.1 7.2L13.9 8.6" />
          <circle cx="9.2" cy="11.2" r="0.9" fill={color} stroke="none" />
          <circle cx="14.8" cy="11.2" r="0.9" fill={color} stroke="none" />
          <path d="M8.4 15.4L15.6 14.2" />
        </>
      )}
      {emotion === Emotion.Neutral && (
        <>
          <circle cx="8.5" cy="10" r="1" fill={color} stroke="none" />
          <circle cx="15.5" cy="10" r="1" fill={color} stroke="none" />
          <path d="M8.8 15L15.2 15" />
        </>
      )}
    </svg>
  )
}
