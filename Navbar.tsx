/**
 * ArduinoButton — Web Serial connection toggle.
 *
 * Lives in the navbar because connecting is a global, session-long action
 * rather than a per-page one: once linked, live detection streams to the
 * hardware regardless of which tab is active.
 *
 * The click handler calls connectArduino() synchronously — Web Serial
 * requires a user gesture for requestPort(), so awaiting anything first
 * would consume the gesture and the browser would reject the prompt.
 */
function ArduinoButton() {
  const { isConnected, isSupported, status, lastError, handleToggle } = useArduino()

  if (!isSupported) {
    return (
      <button
        type="button"
        className="icon-btn cursor-not-allowed opacity-40"
        aria-label="Arduino USB unavailable — requires Chrome or Edge"
        title="Arduino USB needs Chrome or Edge 89+ on a secure (https) page"
        disabled
      >
        <Usb size={16} />
      </button>
    )
  }

  const label = isConnected ? 'Connected' : 'Arduino USB'
  const isBusy = status === 'connecting'
  const tooltip = lastError ?? (isConnected ? 'Disconnect the hardware rig' : 'Connect the hardware rig')

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={isConnected}
      aria-label={`Arduino USB — ${isConnected ? 'connected' : 'disconnected'}`}
      title={tooltip}
      className={cn(
        'inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium',
        'transition-colors duration-200 active:scale-95 sm:h-9',
        isConnected
          ? 'bg-success/10 text-success hover:bg-success/20'
          : 'border border-line text-ink-2 hover:bg-surface-alt hover:text-ink',
        isBusy && 'cursor-wait opacity-60',
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {isConnected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            isConnected ? 'bg-success' : isBusy ? 'bg-warning' : 'bg-ink-3',
          )}
        />
      </span>
      <Usb size={14} className="shrink-0" />
      <span className="hidden md:inline">{label}</span>
    </button>
  )
}

/**
 * Navbar — brand, tab navigation (full keyboard support), comparison badge
 * and the settings menu.
 */
import {
  Activity,
  Clapperboard,
  History,
  ImageUp,
  Settings,
  ShieldCheck,
  Trash2,
  Usb,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { ComparingBadge } from '@/components/dashboard/ComparisonPanel'
import { LogoLockup } from '@/components/shared/Logo'
import { Button } from '@/components/shared/Button'
import { Toggle } from '@/components/shared/Badge'
import { ConfirmModal, Modal } from '@/components/shared/Modal'
import { useArduino } from '@/hooks/useArduino'
import { useSessionHistory } from '@/hooks/useSessionHistory'
import { useAppStore, type TabKey } from '@/store/appStore'
import { APP_NAME, APP_RELEASE_DATE, APP_VERSION } from '@/utils/buildInfo'
import { useSettingsStore } from '@/store/settingsStore'
import type { DetectionQuality } from '@/types/settings'
import { cn } from '@/utils/cn'

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: 'live', label: 'Live', icon: Activity },
  { key: 'upload', label: 'Upload', icon: ImageUp },
  { key: 'video', label: 'Video', icon: Clapperboard },
  { key: 'history', label: 'History', icon: History },
]

export function Navbar({
  currentTab,
  onTabChange,
  comparingCount,
}: {
  currentTab: TabKey
  onTabChange: (tab: TabKey) => void
  comparingCount: number
}) {
  const isCameraSupported = useAppStore((state) => state.isCameraSupported)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyNavigation = (event: React.KeyboardEvent, index: number) => {
    let nextIndex = -1
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    const target = TABS[nextIndex]
    if (target) {
      onTabChange(target.key)
      tabRefs.current[nextIndex]?.focus()
    }
  }

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-line bg-surface/90 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <a
          href="#"
          className="shrink-0 rounded-lg"
          onClick={(event) => event.preventDefault()}
          aria-label="VISION AI home"
        >
          {/* 36px mark inside the 56px bar — 10px optical padding each side */}
          <LogoLockup size={36} />
        </a>

        {/* Below `md` these tabs are replaced by the fixed bottom bar. */}
        <nav
          className="hidden h-full items-center gap-1 md:flex md:gap-2"
          aria-label="Primary"
          role="tablist"
        >
          {TABS.map(({ key, label, icon: Icon }, index) => {
            const isDisabled = key === 'live' && !isCameraSupported
            return (
              <button
                key={key}
                ref={(element) => {
                  tabRefs.current[index] = element
                }}
                type="button"
                role="tab"
                aria-selected={currentTab === key}
                aria-label={isDisabled ? `${label} tab (camera unavailable)` : `${label} tab`}
                aria-current={currentTab === key ? 'page' : undefined}
                disabled={isDisabled}
                tabIndex={currentTab === key ? 0 : -1}
                onKeyDown={(event) => handleKeyNavigation(event, index)}
                onClick={() => onTabChange(key)}
                className={cn(
                  'nav-tab',
                  currentTab === key && 'nav-tab-active',
                  isDisabled && 'cursor-not-allowed opacity-40',
                )}
              >
                <Icon size={15} strokeWidth={2} />
                <span className="hidden sm:inline">{label}</span>
                <span
                  className={cn(
                    'absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary transition-opacity duration-200 sm:inset-x-2',
                    currentTab === key ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {comparingCount >= 2 && <ComparingBadge count={comparingCount} />}
          <ArduinoButton />
          <SettingsMenu />
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-light font-display text-[13px] font-bold text-primary-deep"
            aria-label="Local guest profile"
            title="Local only — no account"
          >
            V
          </div>
        </div>
      </div>
    </header>
  )
}

function SettingsMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { clearAll } = useSessionHistory()

  const isMirrored = useSettingsStore((state) => state.isMirrored)
  const quality = useSettingsStore((state) => state.quality)
  const shouldShowAgeGender = useSettingsStore((state) => state.shouldShowAgeGender)
  const shouldShowFpsCounter = useSettingsStore((state) => state.shouldShowFpsCounter)
  const shouldShowCropDebugger = useSettingsStore((state) => state.shouldShowCropDebugger)
  const isAnimatedContent = useSettingsStore((state) => state.isAnimatedContent)
  const setIsMirrored = useSettingsStore((state) => state.setIsMirrored)
  const setQuality = useSettingsStore((state) => state.setQuality)
  const setShouldShowAgeGender = useSettingsStore((state) => state.setShouldShowAgeGender)
  const setShouldShowFpsCounter = useSettingsStore((state) => state.setShouldShowFpsCounter)
  const setShouldShowCropDebugger = useSettingsStore((state) => state.setShouldShowCropDebugger)
  const setIsAnimatedContent = useSettingsStore((state) => state.setIsAnimatedContent)

  useEffect(() => {
    if (!isOpen) return
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  const handleClearAll = async () => {
    await clearAll()
    setIsConfirmingClear(false)
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setIsOpen((value) => !value)}
        aria-label="Settings"
        aria-expanded={isOpen}
      >
        <Settings size={17} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="card absolute top-11 right-0 w-72 p-4 shadow-pop"
            role="menu"
            aria-label="Settings menu"
          >
            <p className="panel-title mb-3">Preferences</p>

            <div className="flex items-center justify-between gap-3 py-1">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Mirror camera</p>
                <p className="text-xs text-ink-3">Selfie-style flipped preview</p>
              </div>
              <Toggle isChecked={isMirrored} onChange={setIsMirrored} label="Mirror camera" />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Show age &amp; gender</p>
                <p className="text-xs text-ink-3">AI estimates · may be inaccurate</p>
              </div>
              <Toggle
                isChecked={shouldShowAgeGender}
                onChange={setShouldShowAgeGender}
                label="Show age and gender"
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Show FPS counter</p>
                <p className="text-xs text-ink-3">Performance HUD on the feed</p>
              </div>
              <Toggle
                isChecked={shouldShowFpsCounter}
                onChange={setShouldShowFpsCounter}
                label="Show FPS counter"
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Crop debugger</p>
                <p className="text-xs text-ink-3">Preview the exact model input</p>
              </div>
              <Toggle
                isChecked={shouldShowCropDebugger}
                onChange={setShouldShowCropDebugger}
                label="Show crop debugger"
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Animated content</p>
                <p className="text-xs text-ink-3">
                  Contrast boost + confidence sharpening for cartoon media
                </p>
              </div>
              <Toggle
                isChecked={isAnimatedContent}
                onChange={setIsAnimatedContent}
                label="Animated content mode"
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Detector detail</p>
                <p className="text-xs text-ink-3">Higher detail, slightly slower</p>
              </div>
              <div
                className="flex rounded-lg border border-line bg-surface-alt p-0.5"
                role="radiogroup"
                aria-label="Detector detail"
              >
                {(['auto', 'fast', 'balanced'] as DetectionQuality[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={quality === option}
                    onClick={() => setQuality(option)}
                    className={cn(
                      'h-7 rounded-md px-2.5 text-xs font-medium capitalize transition-all duration-200',
                      quality === option
                        ? 'bg-surface text-primary shadow-sm'
                        : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 space-y-1 border-t border-line pt-3">
              <Button
                variant="ghost"
                size="sm"
                isFullWidth
                className="justify-start"
                icon={<ShieldCheck size={14} className="text-primary" />}
                onClick={() => {
                  setIsOpen(false)
                  setIsPrivacyOpen(true)
                }}
              >
                Privacy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                isFullWidth
                className="justify-start text-danger hover:bg-danger/5 hover:text-danger"
                icon={<Trash2 size={14} />}
                onClick={() => {
                  setIsOpen(false)
                  setIsConfirmingClear(true)
                }}
              >
                Delete all data
              </Button>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-snug text-ink-3">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              On-device inference · nothing leaves this browser
            </p>
            <p
              className="mono-stat mt-2 border-t border-line pt-2 text-[10px] text-ink-3"
              aria-label="Version information"
            >
              {APP_NAME} v{APP_VERSION} · {APP_RELEASE_DATE}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={isConfirmingClear}
        title="Delete all data?"
        body="Every saved session — timelines, distributions and transition logs — will be permanently removed from this device. This cannot be undone."
        confirmLabel="Delete everything"
        onCancel={() => setIsConfirmingClear(false)}
        onConfirm={() => void handleClearAll()}
      />

      <PrivacyDetailsModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />
    </div>
  )
}

function PrivacyDetailsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal
      isOpen={isOpen}
      title="Privacy"
      onClose={onClose}
      footer={
        <Button onClick={onClose} className="px-7">
          Got it
        </Button>
      }
    >
      <PrivacySection title="What is processed">
        Camera frames, uploaded images and uploaded videos are read into memory, analyzed by a
        neural network running inside this browser tab, and discarded immediately.
      </PrivacySection>
      <PrivacySection title="Where it is stored">
        Only session summaries — timelines, emotion distributions and transition logs — are saved,
        in your browser&apos;s IndexedDB on this device. No images or video are ever stored.
      </PrivacySection>
      <PrivacySection title="What is never collected">
        No cloud uploads. No external analytics. No third-party APIs. No account. The only network
        requests are for fonts and the one-time download of the neural-network weights.
      </PrivacySection>
      <PrivacySection title="Deleting your data">
        Use Settings → Delete all data to wipe every saved session instantly, or remove sessions
        individually from the History tab.
      </PrivacySection>
      <PrivacySection title="Accuracy disclosure">
        Emotion, age and gender outputs are statistical estimates. Age carries a ±5–10 year error
        and the gender model is binary — a limitation of the underlying network, not a statement
        about gender identity.
      </PrivacySection>
    </Modal>
  )
}

function PrivacySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-line pt-3.5 first:mt-0 first:border-0 first:pt-0">
      <p className="panel-title mb-1.5">{title}</p>
      <p className="text-[13px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}
