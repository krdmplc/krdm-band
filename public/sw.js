// Keeps the app openable without a connection (at venues with no signal).
// - The app shell (index.html and its hashed /assets/ files) is cached on install
//   and refreshed whenever the page loads with a connection.
// - Product photos (/images/) are cached on first use; "prepare stand" fetches
//   them all. Their keys never change, so cache-first is safe.
// - The API is never cached here: the app keeps what it needs offline in IndexedDB.

const SHELL = 'shell-v1'
const IMAGES = 'images-v1'

async function cacheShell () {
  const cache = await caches.open(SHELL)
  const res = await fetch('/', { cache: 'no-store' })
  if (!res.ok) return
  const html = await res.clone().text()
  await cache.put('/', res)
  const assets = [...html.matchAll(/(?:src|href)="(\/(?:assets|fonts|icons)\/[^"]+)"/g)].map((m) => m[1])
  await cache.addAll([...new Set([...assets, '/manifest.webmanifest', '/fonts/special-elite-latin-400-normal.woff2', '/fonts/special-elite-latin-ext-400-normal.woff2'])])
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, IMAGES].includes(key)) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Pages: the network when there is one (and refresh the cached shell), else the cache.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(event.request)
        if (res.ok) event.waitUntil(cacheShell().catch(() => {}))
        return res
      } catch {
        return (await caches.match('/')) ?? Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/images/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    const cacheName = url.pathname.startsWith('/images/') ? IMAGES : SHELL
    event.respondWith((async () => {
      const hit = await caches.match(event.request)
      if (hit) return hit
      const res = await fetch(event.request)
      if (res.ok) {
        const cache = await caches.open(cacheName)
        await cache.put(event.request, res.clone())
      }
      return res
    })())
  }
})
