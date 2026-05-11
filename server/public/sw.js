// Focus PWA — Service Worker

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    if (event.data) data = event.data.json()
  } catch {}

  const type = data.type ?? 'alert'

  if (type === 'clear') {
    // Silent push — no notification shown, just message open pages to clear their list.
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: 'clear', desktopId: data.desktopId })))
    )
    return
  }

  // type === 'alert'
  const title = data.title || 'Focus — Change detected'
  const body = data.body || 'A change was detected on your screen.'

  event.waitUntil(
    Promise.all([
      // Show OS notification
      self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'focus-alert',
        renotify: true,
        data: data.data ?? {}
      }),
      // Message open pages so they can store and display the notification
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) =>
          clients.forEach((c) =>
            c.postMessage({
              type: 'alert',
              notification: {
                id: (data.data && data.data.bountyBoxId) || crypto.randomUUID(),
                desktopId: (data.data && data.data.desktopId) || '',
                title,
                body,
                receivedAt: Date.now()
              }
            })
          )
        )
    ])
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes('/mobile'))
        if (existing) return existing.focus()
        return self.clients.openWindow('/mobile')
      })
  )
})
