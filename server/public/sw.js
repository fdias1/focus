// Focus PWA — Service Worker

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ---------------------------------------------------------------------------
// IndexedDB helpers — used by pushsubscriptionchange to read clientId
// without access to the page's localStorage.
// ---------------------------------------------------------------------------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('focus-push', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('meta')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key) {
  const db = await idbOpen()
  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readonly')
    const req = tx.objectStore('meta').get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => resolve(null)
  })
}

async function idbSet(key, value) {
  const db = await idbOpen()
  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put(value, key)
    tx.oncomplete = () => resolve(undefined)
    tx.onerror = () => resolve(undefined)
  })
}

// ---------------------------------------------------------------------------
// Push subscription change — fired by the browser when the push service
// rotates or expires the subscription, even while the app is closed.
// We resubscribe immediately so notifications keep arriving without the
// user ever needing to reopen the app.
// ---------------------------------------------------------------------------

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const clientId = await idbGet('clientId')
      if (!clientId) return

      // oldSubscription.options carries the applicationServerKey we originally used.
      const options = event.oldSubscription
        ? event.oldSubscription.options
        : event.newSubscription
          ? event.newSubscription.options
          : null
      if (!options) return

      const newSub = await self.registration.pushManager.subscribe(options)
      const lastSubAt = await idbGet('lastSubAt') ?? new Date(0).toISOString()

      const res = await fetch('/api/web-push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, subscription: newSub.toJSON(), since: lastSubAt })
      })

      await idbSet('lastSubAt', new Date().toISOString())

      if (!res.ok) return
      const { missed } = await res.json()
      if (!Array.isArray(missed) || missed.length === 0) return

      // Show OS notifications for each missed alert and message any open pages.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      await Promise.all(
        missed.map((n) => {
          clients.forEach((c) =>
            c.postMessage({
              type: 'alert',
              notification: {
                id: n.id,
                desktopId: n.desktopId,
                title: n.title,
                body: n.body,
                receivedAt: new Date(n.sentAt).getTime()
              }
            })
          )
          return self.registration.showNotification(n.title, {
            body: n.body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `focus-missed-${n.id}`,
            renotify: false,
            data: { desktopId: n.desktopId, notificationId: n.id }
          })
        })
      )
    })()
  )
})

// ---------------------------------------------------------------------------
// Push — receive and display notifications (app may be closed)
// ---------------------------------------------------------------------------

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
  // Use the server-generated stable ID for deduplication when replaying missed notifications.
  const notifId = (data.data && data.data.notificationId) || `${desktopId || 'unknown'}-${Date.now()}`

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
