import webpush from 'web-push'

export interface WebPushPayload {
  type: 'alert' | 'clear'
  title: string
  body: string
  data?: Record<string, unknown>
}

let configured = false

function configure() {
  if (configured) return
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL ?? 'focus@example.com'}`,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
  configured = true
}

/**
 * Sends a Web Push notification to one or more stored subscription JSON strings.
 * Failures for individual subscriptions are silently dropped (expired/invalid endpoints).
 */
export async function sendWebPush(
  subscriptionJsons: string[],
  payload: WebPushPayload
): Promise<void> {
  if (subscriptionJsons.length === 0) return
  configure()

  await Promise.allSettled(
    subscriptionJsons.map((raw) => {
      const sub = JSON.parse(raw) as webpush.PushSubscription
      return webpush.sendNotification(sub, JSON.stringify(payload))
    })
  )
}
