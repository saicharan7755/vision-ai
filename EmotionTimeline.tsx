/**
 * EmotionTimeline — multi-line emotion chart with a soft area fill under
 * the dominant line and an optional scrub playhead.
 *
 * The container height is fixed by the caller so streaming data can never
 * cause layout shift.
 */
import { memo, useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useBreakpoint } from '@/hooks/useMediaQuery'
import { EMOTIONS, type Emotion, type EmotionSnapshot } from '@/types/emotion'
import { EMOTION_META } from '@/utils/constants'

interface TooltipEntry {
  value: number
  dataKey?: string | number
}

function TimelineTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number
}) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload
    .filter((entry) => typeof entry.dataKey === 'string')
    .filter((entry) => (EMOTIONS as readonly string[]).includes(String(entry.dataKey)))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4)

  return (
    <div className="card px-3 py-2 shadow-pop">
      <p className="mono-stat text-[11px] text-ink-3">{Math.round(Number(label))}s</p>
      <div className="mt-1 space-y-1">
        {rows.map((row) => {
          const emotion = String(row.dataKey) as Emotion
          return (
            <div key={emotion} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: EMOTION_META[emotion].color }}
              />
              <span className="w-14 text-ink-2">{EMOTION_META[emotion].label}</span>
              <span className="mono-stat ml-auto text-ink">{row.value}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Long videos produce thousands of samples; cap the rendered point count. */
const MAX_CHART_POINTS = 600

export const EmotionTimeline = memo(function EmotionTimeline({
  samples,
  heightClassName = 'chart-box',
  idleHint,
  playheadT,
  onSeek,
}: {
  samples: readonly EmotionSnapshot[]
  /**
   * Height is CSS-driven (see .chart-box in globals.css) so rotating a
   * device or dragging a window resizes the chart without a React render.
   */
  heightClassName?: string
  idleHint?: string
  playheadT?: number
  onSeek?: (seconds: number) => void
}) {
  // Recharts props cannot be expressed in CSS, so this one value is read
  // from a media query: grid lines and dense ticks clutter a phone chart.
  const isCompact = !useBreakpoint('sm')
  // Downsample beyond the cap (always keeping the newest point) so a
  // 10-minute video doesn't push 3000 points × 7 lines through Recharts.
  const displaySamples = useMemo(() => {
    if (samples.length <= MAX_CHART_POINTS) return samples
    const step = Math.ceil(samples.length / MAX_CHART_POINTS)
    const reduced = samples.filter((_, index) => index % step === 0)
    const newest = samples[samples.length - 1]
    if (newest && reduced[reduced.length - 1] !== newest) reduced.push(newest)
    return reduced
  }, [samples])

  const rows = useMemo(
    () =>
      displaySamples.map((sample) => {
        const row: Record<string, number> = { t: sample.t }
        for (const emotion of EMOTIONS) {
          row[emotion] = Math.round(sample.scores[emotion] * 100)
        }
        row.dominantValue = row[sample.dominant] ?? 0
        return row
      }),
    [displaySamples],
  )

  const hasData = samples.some((sample) => sample.faceCount > 0)
  const currentDominant = samples.length > 0 ? samples[samples.length - 1]?.dominant : undefined

  return (
    <div className={`relative w-full ${heightClassName}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 10, right: 10, bottom: 0, left: -12 }}
          onClick={(state: { activeLabel?: string | number }) => {
            if (!onSeek) return
            const seconds = Number(state?.activeLabel)
            if (Number.isFinite(seconds)) onSeek(seconds)
          }}
          style={onSeek ? { cursor: 'pointer' } : undefined}
        >
          {/* Grid lines clutter a phone-width chart, so they are dropped
              below `sm` rather than shrunk. */}
          {!isCompact && <CartesianGrid stroke="#F1F5F9" vertical={false} />}
          {/* A NUMERIC axis is required for the playhead ReferenceLine to
              render at an arbitrary x — on a category axis it only draws
              when x exactly matches a category, which a moving playhead
              never does. */}
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickLine={false}
            axisLine={{ stroke: '#F1F5F9' }}
            tick={{ fill: '#94A3B8', fontSize: isCompact ? 10 : 11, fontFamily: 'JetBrains Mono' }}
            tickFormatter={(value: number) => `${Math.round(value)}s`}
            minTickGap={isCompact ? 72 : 52}
          />
          <YAxis
            domain={[0, 100]}
            ticks={isCompact ? [0, 50, 100] : [0, 25, 50, 75, 100]}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#94A3B8', fontSize: isCompact ? 10 : 11 }}
            width={isCompact ? 26 : 34}
          />
          <Tooltip content={<TimelineTooltip />} cursor={{ stroke: '#E2E8F0' }} />
          <Area
            type="monotone"
            dataKey="dominantValue"
            stroke="none"
            fill="#FF6B00"
            fillOpacity={0.1}
            isAnimationActive={false}
          />
          {EMOTIONS.map((emotion) => (
            <Line
              key={emotion}
              type="monotone"
              dataKey={emotion}
              stroke={EMOTION_META[emotion].color}
              strokeWidth={emotion === currentDominant ? 2 : 1.4}
              strokeOpacity={currentDominant && emotion !== currentDominant ? 0.4 : 0.95}
              dot={false}
              isAnimationActive={false}
            />
          ))}
          {typeof playheadT === 'number' && (
            <ReferenceLine x={playheadT} stroke="#0F172A" strokeWidth={1.5} strokeDasharray="3 3" />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {!hasData && idleHint && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="rounded-full border border-line bg-surface/90 px-3.5 py-1.5 text-xs text-ink-3 shadow-sm">
            {idleHint}
          </p>
        </div>
      )}
    </div>
  )
})
