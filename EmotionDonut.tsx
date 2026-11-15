/**
 * EmotionDonut — time-weighted distribution of emotions in a session.
 */
import { memo, useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { EmotionIcon } from '@/components/shared/EmotionIcon'
import { getDistributionLeader } from '@/services/emotionAnalyzer'
import { EMOTIONS, type EmotionScores } from '@/types/emotion'
import { EMOTION_META } from '@/utils/constants'

export const EmotionDonut = memo(function EmotionDonut({
  distribution,
  size = 168,
}: {
  distribution: EmotionScores
  size?: number
}) {
  const { total, rows } = useMemo(() => {
    const sum = EMOTIONS.reduce((accumulator, emotion) => accumulator + distribution[emotion], 0)
    return {
      total: sum,
      rows: EMOTIONS.map((emotion) => ({
        key: emotion,
        name: EMOTION_META[emotion].label,
        value: Math.round(distribution[emotion] * 10) / 10,
      })).filter((row) => row.value >= 0.1),
    }
  }, [distribution])

  if (total < 0.5) {
    return (
      <div
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-line text-center"
        style={{ width: size, height: size }}
      >
        <p className="max-w-[120px] text-[11px] leading-snug text-ink-3">
          No emotion data captured yet
        </p>
      </div>
    )
  }

  const leader = getDistributionLeader(distribution)

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius="66%"
              outerRadius="88%"
              paddingAngle={3}
              cornerRadius={4}
              stroke="#FFFFFF"
              strokeWidth={2}
              isAnimationActive
              animationDuration={500}
            >
              {rows.map((row) => (
                <Cell key={row.key} fill={EMOTION_META[row.key].color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <EmotionIcon emotion={leader} size={20} className="mx-auto" />
            <p className="mono-stat mt-1 text-[11px] font-semibold text-ink">
              {Math.round((distribution[leader] / total) * 100)}%
            </p>
          </div>
        </div>
      </div>

      <ul className="grid min-w-0 flex-1 gap-1.5">
        {[...rows]
          .sort((a, b) => b.value - a.value)
          .map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: EMOTION_META[row.key].color }}
              />
              <span className="truncate text-ink-2">{row.name}</span>
              <span className="mono-stat ml-auto text-ink-3">
                {Math.round((row.value / total) * 100)}%
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
})
