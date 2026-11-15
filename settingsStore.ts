/**
 * settingsStore — user preferences, persisted to localStorage.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CameraFacing, DetectionQuality, Settings } from '@/types/settings'

const SETTINGS_KEY = 'vision-ai.settings'
const LEGACY_SETTINGS_KEY = 'vision.settings'

/**
 * Settings migrations, run once before zustand persist reads storage.
 *  1. An intermediate `vision-ai.settings` blob whose `showAgeGender` key
 *     predates the shouldShowAgeGender rename is rewritten in place so an
 *     opt-out is never flipped back on by the rename.
 *  2. The very old pre-restructure `vision.settings` shape
 *     (`mirror` / `detail`) is mapped onto the new schema.
 */
function migrateLegacySettings(): void {
  try {
    const current = localStorage.getItem(SETTINGS_KEY)
    if (current !== null) {
      const parsed = JSON.parse(current) as { state?: Record<string, unknown> }
      if (parsed.state) {
        let needsRewrite = false
        if ('showAgeGender' in parsed.state && !('shouldShowAgeGender' in parsed.state)) {
          parsed.state.shouldShowAgeGender = parsed.state.showAgeGender
          delete parsed.state.showAgeGender
          needsRewrite = true
        }
        // 'balanced' was the pre-auto DEFAULT, not a deliberate choice —
        // users who never opened settings should follow the new preset.
        if (parsed.state.quality === 'balanced') {
          parsed.state.quality = 'auto'
          needsRewrite = true
        }
        if (needsRewrite) {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed))
        }
      }
      return
    }

    const raw = localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (!raw) return
    const legacy = JSON.parse(raw) as {
      mirror?: boolean
      detail?: string
      showAgeGender?: boolean
    }
    const state: Settings = {
      isMirrored: legacy.mirror ?? true,
      quality: legacy.detail === 'fast' ? 'fast' : 'balanced',
      shouldShowAgeGender: legacy.showAgeGender ?? true,
      facingMode: 'user',
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ state, version: 1 }))
  } catch {
    /* unreadable legacy data — keep defaults */
  }
}
migrateLegacySettings()

interface SettingsState extends Settings {
  /** Performance HUD on the video feed. */
  shouldShowFpsCounter: boolean
  /** Crop debugger: live preview of the exact model input + raw logits. */
  shouldShowCropDebugger: boolean
  /**
   * Animated-content mode: adapts preprocessing (contrast boost for line
   * art) and sharpens model confidence for cartoon/2D-animated media,
   * which AffectNet models otherwise read as uncertain/Neutral because
   * they were trained on photographs.
   */
  isAnimatedContent: boolean
  setIsMirrored: (isMirrored: boolean) => void
  setQuality: (quality: DetectionQuality) => void
  setShouldShowAgeGender: (shouldShowAgeGender: boolean) => void
  setShouldShowFpsCounter: (shouldShowFpsCounter: boolean) => void
  setShouldShowCropDebugger: (shouldShowCropDebugger: boolean) => void
  setIsAnimatedContent: (isAnimatedContent: boolean) => void
  setFacingMode: (facingMode: CameraFacing) => void
  toggleFacingMode: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      isMirrored: true,
      quality: 'auto',
      shouldShowAgeGender: true,
      shouldShowFpsCounter: true,
      shouldShowCropDebugger: false,
      isAnimatedContent: false,
      facingMode: 'user',

      setIsMirrored: (isMirrored) => set({ isMirrored }),
      setQuality: (quality) => set({ quality }),
      setShouldShowAgeGender: (shouldShowAgeGender) => set({ shouldShowAgeGender }),
      setShouldShowFpsCounter: (shouldShowFpsCounter) => set({ shouldShowFpsCounter }),
      setShouldShowCropDebugger: (shouldShowCropDebugger) => set({ shouldShowCropDebugger }),
      setIsAnimatedContent: (isAnimatedContent) => set({ isAnimatedContent }),
      setFacingMode: (facingMode) => set({ facingMode }),
      toggleFacingMode: () => {
        const next: CameraFacing = get().facingMode === 'user' ? 'environment' : 'user'
        // The rear camera is not a mirror image, so flip the preview too.
        set({ facingMode: next, isMirrored: next === 'user' })
      },
    }),
    {
      name: SETTINGS_KEY,
      version: 1,
    },
  ),
)
