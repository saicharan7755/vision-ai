/**
 * SessionCard — one saved session in the history grid.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRightLeft, Clapperboard, MoreVertical, Trash2, Video } from 'lucide-react'
import { memo } from 'react'
import { EmotionPill } from '@/components/shared/Badge'
import { formatDateTime, formatDuration } from '@/utils/formatters'
import type { Session } from '@/types/session'

export const SessionCard = memo(function SessionCard({
  session,
  isMenuOpen,
  onOpen,
  onToggleMenu,
  onRequestDelete,
}: {
  session: Session
  isMenuOpen: boolean
  onOpen: (id: string) => void
  onToggleMenu: (id: string | null) => void
  onRequestDelete: (session: Session) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(session.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(session.id)
        }
      }}
      aria-label={`Open session from ${formatDateTime(session.startedAt)}`}
      className="card relative cursor-pointer p-4 text-left transition-all duration-200 hover:border-primary hover:shadow-card focus-visible:border-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {formatDateTime(session.startedAt)}
          </p>
          <p className="mono-stat mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
            {session.source === 'video' ? <Clapperboard size={10} /> : <Video size={10} />}
            #{session.id.slice(0, 8)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="chip mono-stat bg-surface-alt text-[11px] text-ink-2">
            {formatDuration(session.durationSec)}
          </span>
          <div className="relative">
            <button
              type="button"
              className="icon-btn h-7 w-7"
              aria-label="Session options"
              aria-expanded={isMenuOpen}
              onClick={(event) => {
                event.stopPropagation()
                onToggleMenu(isMenuOpen ? null : session.id)
              }}
            >
              <MoreVertical size={15} />
            </button>
            <AnimatePresence>
              {isMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleMenu(null)
                    }}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.14 }}
                    className="card absolute right-0 z-40 w-36 p-1 shadow-pop"
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger/5"
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleMenu(null)
                        onRequestDelete(session)
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5 text-xs text-ink-2">
        <EmotionPill emotion={session.dominantEmotion} />
        {session.source === 'calibrated' && (
          <span className="chip border border-primary/40 bg-primary-light text-[10px] text-primary-deep">
            Calibrated
          </span>
        )}
        <span className="text-ink-3">·</span>
        <span className="flex items-center gap-1">
          <ArrowRightLeft size={11} className="text-ink-3" />
          {session.transitions.length} transition{session.transitions.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
})
