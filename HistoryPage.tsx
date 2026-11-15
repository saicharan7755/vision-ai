/**
 * HistoryPage — browse, inspect and delete stored sessions.
 * Storage access goes through useSessionHistory; the grid is paginated so
 * a large archive never janks.
 */
import { History } from 'lucide-react'
import { useCallback, useState } from 'react'
import { SessionCard } from '@/components/history/SessionCard'
import { SessionDetail } from '@/components/history/SessionDetail'
import { Button } from '@/components/shared/Button'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmModal } from '@/components/shared/Modal'
import { useSessionHistory } from '@/hooks/useSessionHistory'
import { getIsPersistent } from '@/services/sessionManager'
import type { Session } from '@/types/session'

const PAGE_SIZE = 24

export function HistoryPage() {
  const { sessions, remove } = useSessionHistory()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return
    if (selectedId === pendingDelete.id) setSelectedId(null)
    await remove(pendingDelete)
    setPendingDelete(null)
  }, [pendingDelete, remove, selectedId])

  if (sessions === null) {
    return (
      <div className="grid grid-cols-1 gap-3 pb-10 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="card h-32 animate-pulse bg-surface-alt/50" />
        ))}
      </div>
    )
  }

  const selected = sessions.find((session) => session.id === selectedId) ?? null
  if (selected) {
    return <SessionDetail session={selected} onBack={() => setSelectedId(null)} />
  }

  if (sessions.length === 0) {
    return (
      <div className="card mx-auto max-w-xl pb-2">
        <EmptyState
          icon={<History size={26} strokeWidth={1.5} />}
          title="No sessions yet. Start your first analysis to see results here."
          description={
            getIsPersistent()
              ? 'Sessions are saved on this device automatically when you stop them.'
              : "Storage is unavailable in private browsing, so sessions won't persist."
          }
        />
      </div>
    )
  }

  return (
    <div className="pb-10">
      <p className="mb-4 text-sm text-ink-2">
        <span className="mono-stat font-semibold text-ink">{sessions.length}</span> session
        {sessions.length === 1 ? '' : 's'} stored locally
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sessions.slice(0, visibleCount).map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isMenuOpen={openMenuId === session.id}
            onOpen={setSelectedId}
            onToggleMenu={setOpenMenuId}
            onRequestDelete={setPendingDelete}
          />
        ))}
      </div>

      {visibleCount < sessions.length && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            Load {Math.min(PAGE_SIZE, sessions.length - visibleCount)} more
          </Button>
        </div>
      )}

      <ConfirmModal
        isOpen={pendingDelete !== null}
        title="Delete this session?"
        body="The session timeline, distribution and transition log will be permanently removed from this device."
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
