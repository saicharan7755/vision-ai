/**
 * Badge primitives: generic pills, person IDs, emotion pills and the
 * circular progress ring.
 */
import type { ReactNode } from 'react'
import { EMOTION_META } from '@/utils/constants'
import { clamp } from '@/utils/geometry'
import { formatPercent } from '@/utils/formatters'
import type { Emotion } from '@/types/emotion'
import { cn } from '@/utils/cn'

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-alt text-ink-2',
  primary: 'bg-primary-light text-primary-deep',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-[#FEF3C7] text-[#B45309]',
  danger: 'bg-danger/10 text-danger',
}

export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
}: {
  tone?: BadgeTone
  icon?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <span className={cn('chip', TONE_CLASSES[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

/** Small numbered circle used on face overlays and person lists. */
export function PersonBadge({ id, className }: { id: number; className?: string }) {
  return (
    <span
      className={cn(
        'grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-primary px-1',
        'text-[10px] font-bold text-white',
        className,
      )}
      aria-label={`Person ${id}`}
    >
      {id}
    </span>
  )
}

export function EmotionPill({
  emotion,
  confidence,
}: {
  emotion: Emotion
  confidence?: number
}) {
  const meta = EMOTION_META[emotion]
  return (
    <span className="chip border bg-surface text-ink" style={{ borderColor: `${meta.color}55` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
      {typeof confidence === 'number' && (
        <span className="mono-stat text-ink-2">{formatPercent(confidence)}</span>
      )}
    </span>
  )
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 5.5,
  color = '#FF6B00',
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = clamp(value, 0, 1)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 300ms ease-out, stroke 300ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="mono-stat text-[11px] font-semibold text-primary">
          {formatPercent(clamped)}
        </span>
      </div>
    </div>
  )
}

/** Toggle switch with correct switch semantics. */
export function Toggle({
  isChecked,
  onChange,
  label,
}: {
  isChecked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={label}
      onClick={() => onChange(!isChecked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        isChecked ? 'bg-primary' : 'bg-line',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200',
          isChecked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="panel-title">{children}</h3>
      {right}
    </div>
  )
}
