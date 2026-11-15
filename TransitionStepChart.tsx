/**
 * TransitionStepChart — dominant emotion as a step plot across a session.
 */
import { EMOTIONS, type Emotion, type TransitionEvent } from '@/types/emotion'
import { EMOTION_META } from '@/utils/constants'

export function TransitionStepChart({
  transitions,
  durationSec,
  initialEmotion,
}: {
  transitions: readonly TransitionEvent[]
  durationSec: number
  initialEmotion: Emotion
}) {
  const width = 680
  const height = 196
  const padLeft = 84
  const padRight = 20
  const padTop = 14
  const padBottom = 26
  const innerWidth = width - padLeft - padRight
  const stepHeight = (height - padTop - padBottom) / (EMOTIONS.length - 1)
  const duration = Math.max(durationSec, 1)

  const toX = (t: number) => padLeft + (Math.min(t, duration) / duration) * innerWidth
  const toY = (emotion: Emotion) =>
    padTop + (EMOTIONS.length - 1 - EMOTIONS.indexOf(emotion)) * stepHeight

  const ordered = [...transitions].sort((a, b) => a.t - b.t)
  let path = `M ${toX(0)} ${toY(initialEmotion)}`
  let current = initialEmotion
  for (const transition of ordered) {
    path += ` L ${toX(transition.t)} ${toY(current)} L ${toX(transition.t)} ${toY(transition.to)}`
    current = transition.to
  }
  path += ` L ${toX(duration)} ${toY(current)}`

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * duration)

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[560px]"
        role="img"
        aria-label="Emotion transition timeline"
      >
        {EMOTIONS.map((emotion) => (
          <g key={emotion}>
            <line
              x1={padLeft}
              y1={toY(emotion)}
              x2={width - padRight}
              y2={toY(emotion)}
              stroke="#F1F5F9"
              strokeWidth={1}
            />
            <text
              x={padLeft - 8}
              y={toY(emotion) + 3}
              textAnchor="end"
              fontSize={10}
              fill="#94A3B8"
              fontFamily="Inter, sans-serif"
            >
              {EMOTION_META[emotion].label}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text
            key={tick}
            x={toX(tick)}
            y={height - 8}
            textAnchor="middle"
            fontSize={10}
            fill="#94A3B8"
            fontFamily="JetBrains Mono, monospace"
          >
            {Math.round(tick)}s
          </text>
        ))}
        <path d={path} fill="none" stroke="#FF6B00" strokeWidth={1.8} strokeLinejoin="round" />
        {ordered.map((transition) => (
          <circle
            key={transition.id}
            cx={toX(transition.t)}
            cy={toY(transition.to)}
            r={3.4}
            fill={EMOTION_META[transition.to].color}
            stroke="#fff"
            strokeWidth={1.4}
          />
        ))}
      </svg>
      {transitions.length === 0 && (
        <p className="-mt-3 pb-1 text-center text-[11px] text-ink-3">
          Emotion stayed constant for the whole session
        </p>
      )}
    </div>
  )
}
