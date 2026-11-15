/**
 * ErrorBoundary — last line of defence.
 * A render crash anywhere below shows a friendly recovery screen instead of
 * a blank white page.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { Logo } from './Logo'
import { createId } from '@/utils/formatters'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  /** Short crash reference the user can quote in a report. */
  errorId: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorId: '' }

  static getDerivedStateFromError(): State {
    return { hasError: true, errorId: '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Developer-facing only; the user never sees a stack trace.
    console.error('[VISION AI] unhandled render error', error, info.componentStack)
    this.setState({ errorId: createId() })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-canvas px-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <Logo size={52} />
          <h1 className="mt-5 font-display text-xl font-bold text-ink">Something went wrong</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            VISION AI hit an unexpected error. Your saved sessions are safe on this device —
            refreshing the page should get you back on track.
          </p>
          <div className="mt-6 flex items-center justify-center gap-4">
            <Button onClick={this.handleReload} icon={<RefreshCw size={14} />}>
              Refresh the page
            </Button>
            <a
              href="mailto:support@vision-ai.app?subject=VISION%20AI%20crash%20report&body=What%20were%20you%20doing%20when%20the%20error%20occurred%3F"
              className="text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary-deep hover:underline"
            >
              Report issue
            </a>
          </div>
          <p className="mono-stat mt-6 text-[11px] text-ink-3">
            Error reference: {this.state.errorId}
          </p>
        </div>
      </div>
    )
  }
}
