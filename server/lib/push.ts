export interface PushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
}

/**
 * Sends push notifications via the Expo Push API.
 * Silently skips tokens that aren't valid Expo push tokens.
 */
export async function sendPush(messages: PushMessage[]): Promise<void> {
  const valid = messages.filter((m) => m.to.startsWith('ExponentPushToken['))
  if (valid.length === 0) return

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(valid)
  })
}
