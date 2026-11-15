/**
 * SessionStats — the stat strip and its shared stat tile.
 */
import { ArrowRightLeft, Clock, Repeat2, Users, Zap } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { formatClock, formatPercent } from '@/utils/formatters'
import type { SessionStats as SessionStatsModel } from '@/types/session'

export function StatTile({
  icon,
  label,
  value,
}: {
  icon?: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-alt/60 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
        {icon && <span className="text-primary">{icon}</span>}
        <span className="truncate">{label}</span>
      </p>
      <p className="mono-stat mt-1.5 text-lg font-semibold text-ink">{value}</p>
    </div>
  )
}

export const SessionStats = memo(function SessionStats({
  stats,
  isComparing,
}: {
  stats: SessionStatsModel
  isComparing: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile icon={<Clock size={15} />} label="Duration" value={formatClock(stats.durationSec)} />
      <StatTile icon={<Users size={15} />} label="Peak faces" value={String(stats.peakFaces)} />
      <StatTile
        icon={<ArrowRightLeft size={15} />}
        label="Transitions"
        value={String(stats.transitionCount)}
      />
      <StatTile
        icon={isComparing ? <Repeat2 size={15} /> : <Zap size={15} />}
        label={isComparing ? 'Mirroring' : 'Avg intensity'}
        value={isComparing ? String(stats.mirrorCount) : formatPercent(stats.avgIntensity)}
      />
    </div>
  )
})
