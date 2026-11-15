/**
 * TransitionFeed — newest-first list of confirmed emotion transitions.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { memo } from 'react'
import { PersonBadge } from '@/components/shared/Badge'
import { EMOTION_META } from '@/utils/constants'
import { formatClock } from '@/utils/formatters'
import type { Emotion, TransitionEvent } from '@/types/emotion'
import { cn } from '@/utils/cn'

function EmotionTag({ emotion }: { emotion: Emotion }) {
  const meta = EMOTION_META[emotion]
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
      <span className="truncate text-[11px] font-medium text-ink">{meta.label}</span>
    </span>
  )
}

export const TransitionFeed = memo(function TransitionFeed({
  transitions,
  className,
  maxItems = 20,
}: {
  transitions: readonly TransitionEvent[]
  className?: string
  maxItems?: number
}) {
  const visible = transitions.slice(0, maxItems)

  return (
    <div
      className={cn('space-y-1.5 overflow-y-auto pr-1', className)}
      role="log"
      aria-label="Emotion transitions"
    >
      <AnimatePresence initial={false}>
        {visible.map((transition) => (
          <motion.div
            key={transition.id}
            layout
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2"
          >
            <span className="mono-stat w-10 shrink-0 text-[11px] text-ink-3">
              {formatClock(transition.t)}
            </span>
            <PersonBadge id={transition.personId} />
            <EmotionTag emotion={transition.from} />
            <ArrowRight size={12} className="shrink-0 text-[#CBD5E1]" aria-hidden="true" />
            <EmotionTag emotion={transition.to} />
            <span
              className={cn(
                'chip ml-auto shrink-0 px-2 py-0.5 text-[10px] font-semibold',
                transition.speed === 'sudden'
                  ? 'bg-[#FEF3C7] text-[#B45309]'
                  : 'bg-surface-alt text-ink-2',
              )}
            >
              {transition.speed === 'sudden' ? 'Sudden' : 'Gradual'}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
      {transitions.length === 0 && (
        <p className="py-5 text-center text-xs leading-relaxed text-ink-3">
          No transitions yet — they appear when someone&apos;s dominant emotion changes for at
          least a second.
        </p>
      )}
    </div>
  )
})
