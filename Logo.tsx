/**
 * Logo — the VISION AI brand mark and wordmark.
 *
 * Rendered as inline SVG rather than an <img src="/logo.svg"> so that it is
 * resolution-independent (sharp at 16px favicon through 120px splash), needs
 * no extra network request, inherits currentColor where useful, and can never
 * be clipped by a background box. Geometry is kept identical to
 * `public/logo.svg` — update both together.
 */

/** Brand colors, duplicated locally so the mark is self-contained. */
const ORANGE = '#FF6B00'
const SLATE = '#1E293B'

export interface LogoProps {
  /** Rendered width in px; height matches (the viewBox is square). */
  size?: number
  className?: string
  /** Swap the swoosh to orange too — used on the splash for a warmer read. */
  isMonochrome?: boolean
}

export function Logo({ size = 36, className, isMonochrome = false }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      shapeRendering="geometricPrecision"
      aria-hidden="true"
      focusable="false"
    >
      {/* orbital swoosh sits behind the V */}
      <path
        d="M13.6 74.7 A50 20 -22 0 1 106.4 37.3"
        fill="none"
        stroke={isMonochrome ? ORANGE : SLATE}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <path d="M22 28 H38 L60 78 L82 28 H98 L68 96 H52 Z" fill={ORANGE} />
    </svg>
  )
}

/** Mark + "VISION AI" wordmark, for the navbar and splash. */
export function LogoLockup({
  size = 36,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span className={`flex items-center gap-2.5 select-none ${className ?? ''}`}>
      <Logo size={size} />
      <span className="font-display text-[15px] font-bold tracking-[0.08em] whitespace-nowrap">
        <span style={{ color: SLATE }}>VISION</span>
        <span style={{ color: ORANGE }}> AI</span>
      </span>
    </span>
  )
}

/**
 * Back-compat alias.
 * @deprecated Use `Logo` instead.
 */
export const LogoMark = Logo
