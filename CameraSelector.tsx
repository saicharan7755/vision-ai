/**
 * CameraSelector — dropdown for choosing among enumerated video inputs,
 * including external USB / phone webcams.
 *
 * Rendered as a custom listbox rather than a native <select> because a
 * native control cannot be styled to the theme, cannot show the
 * "external device" affordance, and draws its popup outside our control on
 * several platforms. Keyboard support follows the WAI-ARIA listbox
 * pattern: arrows move, Enter/Space selects, Escape closes.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, Check, ChevronDown, Smartphone, Usb } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '@/components/shared/Button'
import type { CameraDevice } from '@/hooks/useCamera'
import { cn } from '@/utils/cn'

/** Heuristic: does this label look like an external / virtual source? */
function looksExternal(label: string): boolean {
  const normalized = label.toLowerCase()
  return (
    normalized.includes('droidcam') ||
    normalized.includes('camo') ||
    normalized.includes('iriun') ||
    normalized.includes('epoccam') ||
    normalized.includes('webcam') && normalized.includes('android') ||
    normalized.includes('phone') ||
    normalized.includes('usb')
  )
}

export function CameraSelector({
  cameras,
  activeDeviceId,
  onSelect,
  onRequestHelp,
}: {
  cameras: readonly CameraDevice[]
  activeDeviceId: string | null
  onSelect: (deviceId: string) => void
  onRequestHelp: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)

  const activeCamera =
    cameras.find((camera) => camera.deviceId === activeDeviceId) ?? null

  // Close on outside click / Escape.
  useEffect(() => {
    if (!isOpen) return
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
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

  // Keep the highlighted row inside the list when it opens.
  useEffect(() => {
    if (isOpen) {
      const index = cameras.findIndex((camera) => camera.deviceId === activeDeviceId)
      setFocusedIndex(index >= 0 ? index : 0)
    }
  }, [isOpen, cameras, activeDeviceId])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        setIsOpen(true)
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setFocusedIndex((index) => Math.min(cameras.length - 1, index + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setFocusedIndex((index) => Math.max(0, index - 1))
        break
      case 'Enter': {
        event.preventDefault()
        const camera = cameras[focusedIndex]
        if (camera) {
          onSelect(camera.deviceId)
          setIsOpen(false)
        }
        break
      }
      case ' ':
        event.preventDefault()
        break
      default:
        break
    }
  }

  return (
    <div className="relative flex items-center gap-1" ref={containerRef}>
      <div
        role="listbox"
        aria-label="Select camera"
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="contents"
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-label={`Camera: ${activeCamera?.label ?? 'Default'}`}
          className={cn(
            'inline-flex h-11 max-w-[190px] items-center gap-1.5 rounded-lg border px-2.5',
            'text-xs font-medium transition-colors duration-200 active:scale-95 sm:h-9',
            isOpen
              ? 'border-primary bg-primary-light/40 text-primary-deep'
              : 'border-line bg-surface text-ink-2 hover:border-primary/40 hover:text-ink',
          )}
        >
          {activeCamera && looksExternal(activeCamera.label) ? (
            <Smartphone size={14} className="shrink-0" />
          ) : (
            <Camera size={14} className="shrink-0" />
          )}
          <span className="truncate">{activeCamera?.label ?? 'Default camera'}</span>
          <ChevronDown
            size={13}
            className={cn('shrink-0 transition-transform duration-200', isOpen && 'rotate-180')}
          />
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="card absolute top-full left-0 z-50 mt-1.5 w-64 overflow-hidden p-1 shadow-pop"
            role="listbox"
            aria-label="Available cameras"
          >
            {cameras.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-ink-3">
                No cameras found. Grant camera permission, or plug a device in.
              </p>
            ) : (
              cameras.map((camera, index) => {
                const isActive = camera.deviceId === activeDeviceId
                return (
                  <button
                    key={camera.deviceId}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onSelect(camera.deviceId)
                      setIsOpen(false)
                    }}
                    onMouseEnter={() => setFocusedIndex(index)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs',
                      'transition-colors duration-150',
                      index === focusedIndex ? 'bg-surface-alt' : 'hover:bg-surface-alt/60',
                      isActive && 'text-primary-deep',
                    )}
                  >
                    {looksExternal(camera.label) ? (
                      <Smartphone size={13} className="shrink-0 text-primary" />
                    ) : (
                      <Usb size={13} className="shrink-0 text-ink-3" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">
                      {camera.label}
                    </span>
                    {isActive && <Check size={13} className="shrink-0 text-primary" />}
                  </button>
                )
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <IconButton
        label="How to use your phone as a webcam"
        icon={<span className="text-[13px] font-bold">?</span>}
        className="h-11 w-11 sm:h-9 sm:w-9"
        onClick={onRequestHelp}
      />
    </div>
  )
}
