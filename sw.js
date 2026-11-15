/**
 * VISION AI service worker.
 *
 * Deliberately conservative: it caches ONLY the ML model weights (local
 * /models/ and the CDN mirrors they may come from). The app shell is never
 * intercepted, so a stale HTML/JS bundle can never be served — the worst
 * failure mode for a service worker is eliminated by design.
 */
'use strict'

const CACHE_NAME = 'vision-ai-models-v1'

const WEIGHT_HOSTS = [
  'cdn.jsdelivr.net',
  'justadudewhohacks.github.io',
]

function isWeightRequest(url) {
  if (url.pathname.startsWith('/models/')) return true
  return WEIGHT_HOSTS.includes(url.hostname) && url.pathname.includes('weights')
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  if (!isWeightRequest(url)) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const hit = await cache.match(event.request)
      if (hit) return hit
      try {
        const response = await fetch(event.request)
        if (response.ok) cache.put(event.request, response.clone())
        return response
      } catch (error) {
        // Offline with an uncached weight: surface the network error so the
        // caller's own fallback chain (multiple CDN mirrors) can kick in.
        return Promise.reject(error)
      }
    }),
  )
})
