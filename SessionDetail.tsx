/**
 * SessionDetail — full breakdown of one stored session.
 */
import { ArrowLeft, ArrowRightLeft, Clock3, Users, Zap } from 'lucide-react'
import { EmotionDonut } from '@/components/dashboard/EmotionDonut'
import { EmotionTimeline } from '@/components/dashboard/EmotionTimeline'
import { TransitionFeed } from '@/components/detection/TransitionFeed'
import { TransitionStepChart } from './TransitionStepChart'
import { Button } from '@/components/shared/Button'
import { EmotionPill, SectionTitle } from '@/components/shared/Badge'
import { StatTile } from '@/components/dashboard/SessionStats'
import { formatClock, formatDateTime, formatDuration, formatPercent } from '@/utils/formatters'
import type { Session } from '@/types/session'

export function SessionDetail({
  session,
  onBack,
}: {
  session: Session
  onBack: () => void
}) {
  const reversedTransitions = [...session.transitions].reverse()
  const initialEmotion = session.timeline[0]?.dominant ?? session.dominantEmotion

  return (
    <div className="pb-10">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 mb-3"
        onClick={onBack}
        icon={<ArrowLeft size={15} />}
      >
        Back to sessions
      </Button>

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold text-ink">
            {formatDateTime(session.startedAt)}
          </h2>
          <p className="mono-stat mt-0.5 text-[11px] text-ink-3">
            session #{session.id.slice(0, 8)} · {session.source}
          </p>
        </div>
        <EmotionPill emotion={session.dominantEmotion} />
        <span className="chip mono-stat bg-surface-alt text-ink-2">
          {formatDuration(session.durationSec)}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={<Clock3 size={14} />} label="Duration" value={formatClock(session.durationSec)} />
        <StatTile icon={<Users size={14} />} label="Peak faces" value={String(session.peakFaces)} />
        <StatTile
          icon={<ArrowRightLeft size={14} />}
          label="Transitions"
          value={String(session.transitions.length)}
        />
        <StatTile icon={<Zap size={14} />} label="Avg intensity" value={formatPercent(session.avgIntensity)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4 sm:p-5 lg:col-span-2">
          <SectionTitle>Emotion timeline</SectionTitle>
          <EmotionTimeline
            samples={session.timeline}
            heightClassName="chart-box-tall"
            idleHint="No samples recorded"
          />
        </div>
        <div className="card p-4 sm:p-5">
          <SectionTitle>Distribution</SectionTitle>
          <div className="flex justify-center py-1">
            <EmotionDonut distribution={session.distribution} size={170} />
          </div>
        </div>
      </div>

      <div className="card mt-4 p-4 sm:p-5">
        <SectionTitle
          right={
            <span className="text-[11px] font-normal tracking-normal normal-case text-ink-3">
              dominant emotion over time
            </span>
          }
        >
          Transition step chart
        </SectionTitle>
        <TransitionStepChart
          transitions={session.transitions}
          durationSec={session.durationSec}
          initialEmotion={initialEmotion}
        />
      </div>

      <div className="card mt-4 p-4 sm:p-5">
        <SectionTitle
          right={
            <span className="mono-stat text-[11px] tracking-normal normal-case text-ink-3">
              {session.transitions.length} events
            </span>
          }
        >
          Transition log
        </SectionTitle>
        <TransitionFeed transitions={reversedTransitions} maxItems={60} className="max-h-80" />
      </div>
    </div>
  )
}
