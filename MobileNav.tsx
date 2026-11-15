/**
 * MobileNav — fixed bottom tab bar for phone-sized viewports (< md).
 *
 * Replaces the top navbar's tab strip below `md`, which is the standard
 * phone pattern: the bar sits within thumb reach and clears the device's
 * gesture inset via env(safe-area-inset-bottom).
 */
import { Activity, Clapperboard, History, ImageUp } from 'lucide-react'
import { useAppStore, type TabKey } from '@/store/appStore'
import { cn } from '@/utils/cn'

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'upload', label: 'Upload', icon: ImageUp },
  { key: 'video', label: 'Video', icon: Clapperboard },
  { key: 'history', label: 'History', icon: History },
]

export function MobileNav({
  currentTab,
  onTabChange,
}: {
  currentTab: TabKey
  onTabChange: (tab: TabKey) => void
}) {
  const isCameraSupported = useAppStore((state) => state.isCameraSupported)

  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-sm md:hidden"
      aria-label="Primary"
      role="tablist"
    >
      <div className="flex items-stretch justify-around">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = currentTab === key
          const isDisabled = key === 'live' && !isCameraSupported
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={isDisabled ? `${label} tab (camera unavailable)` : `${label} tab`}
              disabled={isDisabled}
              onClick={() => onTabChange(key)}
              className={cn(
                // 56px tall: comfortably past the 44px minimum hit area.
                'relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1',
                'transition-transform duration-150 active:scale-95',
                isActive ? 'text-primary' : 'text-ink-3',
                isDisabled && 'cursor-not-allowed opacity-40',
              )}
            >
              <span
                className={cn(
                  'absolute top-0 h-0.5 w-10 rounded-full bg-primary transition-opacity duration-200',
                  isActive ? 'opacity-100' : 'opacity-0',
                )}
              />
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium tracking-wide">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
