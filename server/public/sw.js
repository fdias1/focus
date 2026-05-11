// Focus PWA — Service Worker

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    if (event.data) data = event.data.json()
  } catch {}

  // type and desktopId are top-level fields in the payload
  const type = data.type ?? 'alert'
  const desktopId = (data.data && data.data.desktopId) || ''

  if (type === 'clear') {
    // Silent push — no notification shown, just message open pages to clear their list.
    // Drop the message if desktopId is missing so we don't wipe ALL notifications.
    if (!desktopId) return
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: 'clear', desktopId })))
    )
    return
  }

  // type === 'alert'
  const title = data.title || 'Focus — Change detected'
  const body = data.body || 'A change was detected on your screen.'
  const notifId = `${desktopId || 'unknown'}-${Date.now()}`

  event.waitUntil(
    Promise.all([
      // Advance the missed-notification watermark so a later resync doesn't replay this one.
      idbSet('lastSubAt', new Date().toISOString()),
      self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'focus-alert',
        renotify: true,
        data: data.data ?? {}
      }),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) =>
          clients.forEach((c) =>
            c.postMessage({
              type: 'alert',
              notification: {
                id: notifId,
                desktopId,
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
