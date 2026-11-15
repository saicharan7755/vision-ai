import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import '@/styles/globals.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root was not found in index.html')

// Register the model-caching service worker in production only — in dev it
// would just make cold-start debugging harder by serving stale weights.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('[VISION AI] service worker registration failed', error)
    })
  })
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
