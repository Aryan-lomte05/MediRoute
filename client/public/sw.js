/**
 * ==============================================================================
 * MEDIROUTE - SERVICE WORKER
 * ==============================================================================
 *
 * Strategy:
 * - Navigations: network first, falling back to the cached app shell, so the
 *   emergency page still opens with no signal.
 * - Hashed build assets: cache first, since their filenames change on release.
 * - API and websocket traffic: never cached. Stale bed counts or a stale
 *   ambulance position would be worse than no data at all.
 *
 * The cache version must be bumped on any change to this file or the shell.
 * ==============================================================================
 */

const CACHE_NAME = 'mediroute-cache-v2'

/**
 * The emergency page is precached deliberately: a citizen may open the app in a
 * basement, a lift or a dead spot, and the reporting screen has to render even
 * when the request for it fails.
 */
const ASSETS_TO_CACHE = ['/', '/index.html', '/sos', '/manifest.json', '/favicon.svg', '/icons.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll rejects the whole batch if any single entry 404s, which would
      // leave the worker with no cache at all, so entries are added individually.
      Promise.allSettled(ASSETS_TO_CACHE.map((url) => cache.add(url)))
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only GET is cacheable; a POSTed emergency report must always hit the network.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never serve API or socket traffic from cache.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return

  // Leave cross-origin requests (map tiles, fonts, the API host) to the browser.
  if (url.origin !== self.location.origin) return

  // Hashed build output is immutable, so prefer the cache for instant loads.
  const isBuildAsset = url.pathname.startsWith('/assets/')

  if (isBuildAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
            }
            return response
          })
      )
    )
    return
  }

  // Everything else: network first, cache as a fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached

        // A single-page app serves every route from the same shell, so an
        // uncached route offline still resolves to the app.
        if (request.mode === 'navigate') {
          return (await caches.match('/index.html')) || (await caches.match('/'))
        }

        return Response.error()
      })
  )
})
