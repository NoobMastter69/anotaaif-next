const CACHE = 'anotaaif-v3'
const STATIC = ['/', '/calendario', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Network-first, fallback para cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  if (!e.request.url.startsWith(self.location.origin)) return
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
        return res
      })
      .catch(() => caches.match(e.request))
  )
})

// Web Push — mostra notificação quando chegar
self.addEventListener('push', e => {
  if (!e.data) return
  let d = {}
  try { d = e.data.json() } catch { d = { title: 'Anota AIF!', body: e.data.text() } }

  e.waitUntil(
    self.registration.showNotification(d.title ?? 'Anota AIF! ⚡', {
      body: d.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'anotaaif-alert',
      renotify: true,
      data: { url: d.url ?? '/' },
    })
  )
})

// Abre o app ao clicar na notificação
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return clients.openWindow(e.notification.data?.url ?? '/')
    })
  )
})
