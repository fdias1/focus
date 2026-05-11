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
 * Sends a Web Push notification to the given subscriptions.
 * Returns the database IDs of subscriptions that are expired/invalid (HTTP 410 or 404)
 * so the caller can remove them from the database.
 */
export async function sendWebPush(
  subscriptions: Array<{ id: string; subscription: string }>,
  payload: WebPushPayload
): Promise<string[]> {
  if (subscriptions.length === 0) return []
  configure()

  const results = await Promise.allSettled(
    subscriptions.map(async ({ id, subscription }) => {
      const sub = JSON.parse(subscription) as webpush.PushSubscription
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload))
        return { id, expired: false }
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        // 410 Gone = subscription explicitly unsubscribed; 404 = endpoint no longer exists.
        const expired = status === 410 || status === 404
        return { id, expired }
      }
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<{ id: string; expired: boolean }> =>
      r.status === 'fulfilled' && r.value.expired
    )
    .map((r) => r.value.id)
}
