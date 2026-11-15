/**
 * Comparative analysis views (auto-activated with 2+ faces).
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Repeat2, Users2 } from 'lucide-react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { EmotionIcon } from '@/components/shared/EmotionIcon'
import { PersonBadge, ProgressRing, SectionTitle } from '@/components/shared/Badge'
import type { ComparisonState, GanttSegment, SynchronyTone } from '@/services/emotionAnalyzer'
import { EMOTION_META } from '@/utils/constants'
import { formatAge, formatClock, formatGender, formatPercent } from '@/utils/formatters'
import { cn } from '@/utils/cn'

const TONE_CLASSES: Record<SynchronyTone, string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-[#FEF3C7] text-[#B45309]',
  success: 'bg-success/10 text-success',
  accent: 'bg-accent/10 text-accent',
}

export function ComparingBadge({ count }: { count: number }) {
  return (
    <span className="chip bg-accent/10 text-accent" aria-live="polite">
      <Users2 size={12} />
      <span className="hidden sm:inline">Comparing {count} persons</span>
      <span className="sm:hidden">{count}</span>
    </span>
  )
}

export function ComparisonPanel({ state }: { state: ComparisonState }) {
  const [personA, personB] = state.people
  if (!personA || !personB) return null

  const delta = state.dominanceDelta
  const percent = Math.abs(Math.round(delta * 100))
  const leader = delta > 0 ? personA : personB
  const dominanceText =
    percent <= 3
      ? `Similar expression levels (±${percent}%)`
      : `P${leader.id} is more expressive (+${percent}%)`

  return (
    <div className="card p-4">
      <SectionTitle
        right={
          <span className="mono-stat text-[11px] text-ink-3">
            {state.sharedFrames > 0 ? `${state.sharedFrames} frames` : '—'}
          </span>
        }
      >
        Comparison mode
      </SectionTitle>

      <div className="grid grid-cols-2 gap-2">
        {[personA, personB].map((person) => {
          const meta = EMOTION_META[person.dominant]
          const gender = formatGender(person.gender)
          const age = formatAge(person.age)
          return (
            <div key={person.id} className="rounded-lg border border-line bg-surface-alt/50 p-2.5">
              <div className="flex items-center gap-1.5">
                <PersonBadge id={person.id} />
                {(gender || age) && (
                  <span className="truncate text-[11px] text-ink-2">
                    {gender}
                    {gender && age && ' '}
                    {age && <span className="mono-stat">{age}</span>}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <EmotionIcon emotion={person.dominant} size={16} />
                <span className="truncate text-xs font-semibold text-ink">{meta.label}</span>
              </div>
              <p className="mono-stat mt-1 text-[13px] font-semibold" style={{ color: meta.color }}>
                {formatPercent(person.confidence)}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-alt">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: formatPercent(person.confidence),
                    background: meta.color,
                    transition: 'width 250ms ease-out',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 border-t border-line pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="panel-title">Synchrony score</p>
          <span
            className={cn(
              'chip px-2 py-0.5 text-[10px] font-semibold',
              TONE_CLASSES[state.synchronyLabel.tone],
            )}
          >
            {state.synchronyLabel.text}
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <ProgressRing value={state.synchrony} size={52} stroke={5} color="#1E293B" />
          <div className="min-w-0 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-full rounded-full bg-accent"
                style={{
                  width: formatPercent(state.synchrony),
                  transition: 'width 250ms ease-out',
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-2">
              Both show the same emotion{' '}
              <span className="mono-stat font-semibold text-ink">
                {formatPercent(state.synchrony)}
              </span>{' '}
              of shared time.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3.5 border-t border-line pt-3.5">
        <p className="panel-title">Dominance</p>
        <p className="mt-1.5 text-[13px] font-medium text-ink">{dominanceText}</p>
        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-alt">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${50 + Math.max(-50, Math.min(50, delta * 100)) / 2}%` }}
          />
        </div>
        <div className="mono-stat mt-1 flex justify-between text-[10px] text-ink-3">
          <span>P{personA.id}</span>
          <span>P{personB.id}</span>
        </div>
      </div>

      {state.extraFaces > 0 && (
        <p className="mt-3.5 rounded-lg border border-line bg-surface-alt px-2.5 py-2 text-[11px] leading-snug text-ink-2">
          Comparative mode shows the 2 most prominent faces. Tracking {state.extraFaces + 2} faces
          total.
        </p>
      )}
    </div>
  )
}

export function MirroringFeed({ state }: { state: ComparisonState }) {
  return (
    <div className="card p-4">
      <SectionTitle
        right={<span className="mono-stat text-[11px] text-ink-3">{state.mirrorEvents.length}</span>}
      >
        Emotion mirroring
      </SectionTitle>
      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {state.mirrorEvents.map((event) => (
            <motion.div
              key={event.id}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-2"
            >
              <Repeat2 size={13} className="shrink-0 text-accent" />
              <span className="mono-stat shrink-0 text-[11px] text-ink-3">
                {formatClock(event.t)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                <span className="mono-stat font-semibold">P{event.leaderId}</span>
                <span className="text-ink-2"> → </span>
                <span className="mono-stat font-semibold">P{event.followerId}</span>
                <span className="text-ink-2"> mirrored </span>
                <span
                  className="font-medium"
                  style={{ color: EMOTION_META[event.emotion].color }}
                >
                  {EMOTION_META[event.emotion].label}
                </span>
              </span>
              <span className="mono-stat chip shrink-0 bg-surface px-1.5 py-0.5 text-[10px] text-ink-2">
                {event.delaySec.toFixed(1)}s
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {state.mirrorEvents.length === 0 && (
          <p className="py-4 text-center text-[11px] leading-relaxed text-ink-3">
            No mirroring yet — logged when one person adopts the other&apos;s emotion within 3
            seconds.
          </p>
        )}
      </div>
    </div>
  )
}

export function ComparisonLanes({ state }: { state: ComparisonState }) {
  const [personA, personB] = state.people
  if (!personA || !personB) return null

  const ids = [personA.id, personB.id]
  const allSegments = ids.flatMap((id) => state.lanes[id] ?? [])
  if (allSegments.length === 0) return null

  const start = Math.min(...allSegments.map((segment) => segment.start))
  const end = Math.max(...allSegments.map((segment) => segment.end), start + 1)
  const span = Math.max(1, end - start)

  const renderLane = (id: number, segments: GanttSegment[]) => (
    <div key={id} className="flex items-center gap-2">
      <span className="mono-stat w-6 shrink-0 text-[11px] font-semibold text-ink-2">P{id}</span>
      <div className="flex h-5 flex-1 overflow-hidden rounded-md bg-surface-alt">
        {segments.map((segment, index) => {
          const width = ((segment.end - segment.start) / span) * 100
          if (width <= 0.15) return null
          return (
            <div
              key={`${segment.emotion}-${index}`}
              title={`${EMOTION_META[segment.emotion].label} · ${formatClock(segment.start)}–${formatClock(segment.end)}`}
              className="h-full border-r border-white/70 last:border-r-0"
              style={{ width: `${width}%`, background: EMOTION_META[segment.emotion].color, opacity: 0.85 }}
            />
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="space-y-2">
      {ids.map((id) => renderLane(id, state.lanes[id] ?? []))}
      <div className="mono-stat flex justify-between pl-8 text-[10px] text-ink-3">
        <span>{formatClock(start)}</span>
        <span>{formatClock(end)}</span>
      </div>
    </div>
  )
}

export function ComparisonTimeline({
  state,
  height = 190,
}: {
  state: ComparisonState
  height?: number
}) {
  const [personA, personB] = state.people
  const rows = state.series.map((sample) => ({
    t: sample.t,
    a: Math.round(sample.a * 100),
    b: Math.round(sample.b * 100),
    low: Math.round(Math.min(sample.a, sample.b) * 100),
    gap: Math.round(Math.abs(sample.a - sample.b) * 100),
  }))

  if (!personA || !personB || rows.length < 2) {
    return (
      <div className="grid text-center" style={{ height }}>
        <p className="self-center text-xs text-ink-3">
          Collecting comparison data — keep both faces in frame…
        </p>
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#F1F5F9" vertical={false} />
          <XAxis
            dataKey="t"
            tickLine={false}
            axisLine={{ stroke: '#F1F5F9' }}
            tick={{ fill: '#94A3B8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            tickFormatter={(value: number) => `${Math.round(value)}s`}
            minTickGap={52}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#94A3B8', fontSize: 11 }}
            width={34}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: '1px solid #E2E8F0',
              boxShadow: '0 12px 32px -8px rgba(15,23,42,0.16)',
              fontSize: 11,
            }}
            formatter={
              ((value: unknown, name: unknown) => [
                `${Number(value)}%`,
                name === 'a' ? `P${personA.id}` : name === 'b' ? `P${personB.id}` : 'Gap',
              ]) as never
            }
            labelFormatter={((label: unknown) => `${Math.round(Number(label))}s`) as never}
          />
          {/* transparent base + visible band = shaded region between the lines */}
          <Area dataKey="low" stackId="gap" stroke="none" fill="transparent" isAnimationActive={false} />
          <Area
            dataKey="gap"
            stackId="gap"
            stroke="none"
            fill="#94A3B8"
            fillOpacity={0.16}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="a"
            stroke={EMOTION_META[personA.dominant].color}
            strokeWidth={1.8}
            strokeOpacity={0.6}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="b"
            stroke={EMOTION_META[personB.dominant].color}
            strokeWidth={1.8}
            strokeOpacity={0.6}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
