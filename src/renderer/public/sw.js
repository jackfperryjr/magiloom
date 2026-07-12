// Magiloom PWA service worker. Provides installability and Web Push. It does NOT
// cache the app shell — the client needs a live WebSocket to be useful, so there's
// no meaningful offline mode; keeping it cache-free avoids stale-bundle headaches.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// A pass-through fetch handler (no caching) — its presence helps installability
// across browsers.
self.addEventListener('fetch', () => { /* default network handling */ })

// Web Push: the server (magiserver push.ts) sends { title, body, tag } when a
// user's alert rule matches, even while this PWA is closed.
self.addEventListener('push', (event) => {
  let data = { title: 'Magiloom', body: '' }
  try { if (event.data) data = event.data.json() } catch { /* keep default */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Magiloom', {
      body: data.body || '',
      tag: data.tag,
      icon: './android-chrome-192x192.png',
      badge: './android-chrome-192x192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) if ('focus' in c) return c.focus()
      if (self.clients.openWindow) return self.clients.openWindow('./')
    }),
  )
})
