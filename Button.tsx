/**
 * Button — the single source of truth for interactive styling.
 * Consistent hover / active / focus / disabled states everywhere.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft'
export type ButtonSize = 'sm' | 'md'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-sm hover:bg-primary-deep',
  secondary: 'border border-primary bg-surface text-primary hover:bg-primary-light/40',
  ghost: 'text-ink-2 hover:bg-surface-alt hover:text-ink',
  danger: 'bg-danger text-white hover:bg-danger/90',
  dangerSoft:
    'border border-line bg-surface text-danger hover:border-danger/30 hover:bg-danger/5',
}

/**
 * Heights step down on pointer-precise devices. Touch devices get the full
 * 44px minimum hit area (WCAG 2.5.5 / Apple HIG) without making the
 * desktop dashboard feel oversized.
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-11 px-3.5 text-[13px] sm:h-9 sm:px-3',
  md: 'h-11 px-4 text-sm sm:h-10',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  isFullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  isFullWidth = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium',
        'transition-transform transition-colors duration-200 active:scale-95',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isFullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

/** Square icon-only button. */
export function IconButton({
  label,
  icon,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'grid h-11 w-11 place-items-center rounded-lg text-ink-2 sm:h-9 sm:w-9',
        'transition-transform transition-colors duration-200 active:scale-95',
        'hover:bg-surface-alt hover:text-ink disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
}
