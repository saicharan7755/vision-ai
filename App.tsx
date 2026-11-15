/**
 * App — root shell.
 * Owns the splash sequence, privacy gate, tab routing and global chrome.
 * Pages are lazy-loaded so each route is a separate chunk.
 */
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Footer } from '@/components/layout/Footer'
import { MobileNav } from '@/components/layout/MobileNav'
import { Navbar } from '@/components/layout/Navbar'
import { PrivacyNotice } from '@/components/layout/PrivacyNotice'
import { LoadingScreen } from '@/components/shared/LoadingScreen'
import { Toaster } from '@/components/shared/ErrorToast'
import { CropDebugger } from '@/components/camera/CropDebugger'
import { useSettingsStore } from '@/store/settingsStore'
import { getIsCameraSupported } from '@/hooks/useCamera'
import { useLocalStorage, readSessionFlag, writeSessionFlag } from '@/hooks/useLocalStorage'
import { notify, useAppStore, type TabKey } from '@/store/appStore'
import { useSessionStore } from '@/store/sessionStore'

const LivePage = lazy(() =>
  import('@/pages/LivePage').then((module) => ({ default: module.LivePage })),
)
const UploadPage = lazy(() =>
  import('@/pages/UploadPage').then((module) => ({ default: module.UploadPage })),
)
const VideoPage = lazy(() =>
  import('@/pages/VideoPage').then((module) => ({ default: module.VideoPage })),
)
const HistoryPage = lazy(() =>
  import('@/pages/HistoryPage').then((module) => ({ default: module.HistoryPage })),
)

const SPLASH_SEEN_KEY = 'vision-ai.splash-seen'
/** Pre-restructure key, honoured so returning users keep their state. */
const LEGACY_SPLASH_KEY = 'vision.seen'
const PRIVACY_KEY = 'vision-ai.privacy-ack'
const LEGACY_PRIVACY_KEY = 'vision.privacy'

/**
 * One-time migration of pre-restructure localStorage keys. Runs at module
 * scope (before first render) so hooks read the migrated values.
 */
function migrateLegacyStorage(): void {
  try {
    if (
      localStorage.getItem(PRIVACY_KEY) === null &&
      localStorage.getItem(LEGACY_PRIVACY_KEY) === '1'
    ) {
      localStorage.setItem(PRIVACY_KEY, 'true')
    }
    if (!readSessionFlag(SPLASH_SEEN_KEY) && readSessionFlag(LEGACY_SPLASH_KEY)) {
      writeSessionFlag(SPLASH_SEEN_KEY)
    }
  } catch {
    /* storage unavailable — migrations are best-effort */
  }
}
migrateLegacyStorage()

export default function App() {
  const currentTab = useAppStore((state) => state.currentTab)
  const setCurrentTab = useAppStore((state) => state.setCurrentTab)
  const setIsCameraSupported = useAppStore((state) => state.setIsCameraSupported)
  const comparingFaceCount = useSessionStore((state) => state.stats.faceCount)
  const isSessionActive = useSessionStore((state) => state.isActive)
  const shouldShowCropDebugger = useSettingsStore((state) => state.shouldShowCropDebugger)

  const [isSplashVisible, setIsSplashVisible] = useState(true)
  const [isRevealed, setIsRevealed] = useState(false)
  const [isShortSplash] = useState(() => readSessionFlag(SPLASH_SEEN_KEY))
  const [hasAcceptedPrivacy, setHasAcceptedPrivacy] = useState(false)
  const [storedPrivacy, setStoredPrivacy] = useLocalStorage(PRIVACY_KEY, false)

  /* Keep the Video tab mounted once visited so background processing
     survives navigation to other tabs. */
  const [isVideoMounted, setIsVideoMounted] = useState(false)

  const handleReveal = useCallback(() => setIsRevealed(true), [])
  const handleSplashFinish = useCallback(() => {
    setIsSplashVisible(false)
    writeSessionFlag(SPLASH_SEEN_KEY)
  }, [])

  /* Capability check — disables the Live tab rather than failing later. */
  useEffect(() => {
    if (isSplashVisible) return
    const isSupported = getIsCameraSupported()
    setIsCameraSupported(isSupported)
    if (!isSupported) {
      notify(
        'warning',
        'Camera not supported',
        "Your browser doesn't support real-time video analysis. Upload and History still work.",
      )
      setCurrentTab('upload')
    }
  }, [isSplashVisible, setIsCameraSupported, setCurrentTab])

  const handleAcceptPrivacy = useCallback(() => {
    setHasAcceptedPrivacy(true)
    setStoredPrivacy(true)
  }, [setStoredPrivacy])

  const handleTabChange = useCallback(
    (tab: TabKey) => {
      if (tab === 'video') setIsVideoMounted(true)
      setCurrentTab(tab)
    },
    [setCurrentTab],
  )

  const isPrivacyVisible =
    !storedPrivacy && !hasAcceptedPrivacy && !isSplashVisible && isRevealed

  return (
    <div className="min-h-screen">
      {/* ambient background mesh */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="ambient-a absolute -top-32 -left-40 h-[520px] w-[640px] rounded-full bg-[#FFEDD5] opacity-40 blur-[110px]" />
        <div className="ambient-b absolute -right-40 -bottom-44 h-[560px] w-[700px] rounded-full bg-[#FFF7ED] opacity-60 blur-[130px]" />
      </div>

      {isRevealed && (
        <div className="app-enter relative z-10 flex min-h-screen flex-col">
          <Navbar
            currentTab={currentTab}
            onTabChange={handleTabChange}
            comparingCount={currentTab === 'live' && isSessionActive ? comparingFaceCount : 0}
          />

          <main className="mb-mobile-nav mx-auto w-full max-w-[1440px] flex-1 px-4 pt-4 sm:px-6 sm:pt-5 md:mb-0">
            <Suspense fallback={<PageSkeleton />}>
              {currentTab === 'live' && <LivePage />}
              {currentTab === 'upload' && <UploadPage />}
              {currentTab === 'history' && <HistoryPage />}
              {isVideoMounted && (
                <div className={currentTab === 'video' ? undefined : 'hidden'}>
                  <VideoPage />
                </div>
              )}
            </Suspense>
          </main>

          <Footer />
          <MobileNav currentTab={currentTab} onTabChange={handleTabChange} />
        </div>
      )}

      {isSplashVisible && (
        <LoadingScreen
          isShort={isShortSplash}
          onReveal={handleReveal}
          onFinish={handleSplashFinish}
        />
      )}

      {isPrivacyVisible && <PrivacyNotice onAccept={handleAcceptPrivacy} />}

      {shouldShowCropDebugger && <CropDebugger />}

      <Toaster />
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 pb-8 md:grid-cols-12">
      <div className="card aspect-video animate-pulse bg-surface-alt/50 md:col-span-7 lg:col-span-8" />
      <div className="space-y-4 md:col-span-5 lg:col-span-4">
        <div className="card h-32 animate-pulse bg-surface-alt/50" />
        <div className="card h-48 animate-pulse bg-surface-alt/50" />
      </div>
    </div>
  )
}
