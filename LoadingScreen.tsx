/**
 * LoadingScreen — the VISION AI brand reveal.
 *
 * Full sequence (~3.5s) on first visit:
 *   1. the "V" draws as an outline stroke
 *   2. it fills with solid Dynamic Orange
 *   3. the orbital swoosh sweeps left → right
 *   4. "VISION AI" rises in (Deep Slate + Orange), then the tagline
 *   5. the whole composition crossfades into the dashboard
 *
 * A shortened 0.8s fade runs on repeat visits within the same tab session.
 * All motion is CSS keyframes (see styles/animations.css) so the sequence
 * stays on the compositor and never blocks the main thread.
 */
import { useEffect } from 'react'

const ORANGE = '#FF6B00'
const SLATE = '#1E293B'

/** Shared geometry with `Logo.tsx` / `public/logo.svg`. */
const V_PATH = 'M22 28 H38 L60 78 L82 28 H98 L68 96 H52 Z'
const SWOOSH_PATH = 'M13.6 74.7 A50 20 -22 0 1 106.4 37.3'

interface LoadingScreenProps {
  isShort: boolean
  /** Fired when the dashboard should begin fading in underneath. */
  onReveal: () => void
  /** Fired when the splash has finished and can unmount. */
  onFinish: () => void
}

export function LoadingScreen({ isShort, onReveal, onFinish }: LoadingScreenProps) {
  useEffect(() => {
    const revealTimer = window.setTimeout(onReveal, isShort ? 380 : 2900)
    const finishTimer = window.setTimeout(onFinish, isShort ? 820 : 3560)
    return () => {
      window.clearTimeout(revealTimer)
      window.clearTimeout(finishTimer)
    }
  }, [isShort, onReveal, onFinish])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-white"
      role="status"
      aria-label="VISION AI is loading"
    >
      <div className={isShort ? 'splash-short-exit' : 'splash-exit'}>
        <div className="flex flex-col items-center">
          <div className={isShort ? 'splash-short-mark' : 'splash-mark'}>
            {/* overflow-visible guarantees the swoosh caps are never clipped */}
            <svg
              viewBox="0 0 120 120"
              className="h-20 w-20 overflow-visible sm:h-[120px] sm:w-[120px]"
              fill="none"
              shapeRendering="geometricPrecision"
              aria-hidden="true"
            >
              {isShort ? (
                <>
                  <path
                    d={SWOOSH_PATH}
                    fill="none"
                    stroke={SLATE}
                    strokeWidth={8}
                    strokeLinecap="round"
                  />
                  <path d={V_PATH} fill={ORANGE} />
                </>
              ) : (
                <>
                  {/* Step 3 — orbital swoosh, drawn first so it sits behind */}
                  <path
                    className="splash-swoosh"
                    d={SWOOSH_PATH}
                    fill="none"
                    stroke={SLATE}
                    strokeWidth={8}
                    strokeLinecap="round"
                  />
                  {/* Step 2 — solid fill */}
                  <path className="splash-v-fill" d={V_PATH} fill={ORANGE} />
                  {/* Step 1 — outline stroke, retired once the fill lands */}
                  <path
                    className="splash-v-stroke splash-v-stroke-retire"
                    d={V_PATH}
                    fill="none"
                    stroke={ORANGE}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </>
              )}
            </svg>
          </div>

          {!isShort && (
            <>
              {/* Step 4 — wordmark in Deep Slate + Dynamic Orange */}
              <h1 className="splash-title mt-7 font-display text-[32px] font-bold tracking-[0.08em]">
                <span style={{ color: SLATE }}>VISION</span>
                <span style={{ color: ORANGE }}> AI</span>
              </h1>
              <p className="splash-tagline mt-2 text-sm tracking-[0.02em] text-ink-2">
                See Beyond Expressions
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
