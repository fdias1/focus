import { db } from '@/db'
import {
  pairings,
  clientDevices,
  webPushSubscriptions,
  telegramPairings
} from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { sendWebPush } from '@/lib/webpush'
import { escapeMarkdownV2, sendTelegramMessage, sendTelegramPhoto } from '@/lib/telegram'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1),
  imageBase64: z.string().optional()
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId and apiKey are required')

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

  const photo = parsed.data.imageBase64
    ? Buffer.from(parsed.data.imageBase64, 'base64')
    : null

  const paired = await db
    .select({
      clientId: clientDevices.id,
      pairingNickname: pairings.nickname
    })
    .from(pairings)
    .innerJoin(clientDevices, eq(pairings.clientId, clientDevices.id))
    .where(eq(pairings.desktopId, desktopId))

  const tgPaired = await db
    .select({ chatId: telegramPairings.chatId, nickname: telegramPairings.nickname })
    .from(telegramPairings)
    .where(eq(telegramPairings.desktopId, desktopId))

  // Use the pairing's nickname when set; otherwise fall back to a short
  // desktop identifier so the user can still tell which desktop fired the
  // alarm. Same convention used in the PWA pairing list.
  const desktopLabel = `Desktop ${desktopId.slice(0, 8)}`
  const notifTitle = 'Focus — Change detected'
  const notifBody = (nickname: string | null) =>
    `On ${nickname ? `"${nickname}"` : desktopLabel}`

  const clientIds = paired.map((p) => p.clientId)
  if (clientIds.length === 0 && tgPaired.length === 0) {
    return json({ ok: true, web: 0, telegram: 0 })
  }

  const webSubs =
    clientIds.length === 0
      ? []
      : await db
          .select({
            id: webPushSubscriptions.id,
            subscription: webPushSubscriptions.subscription,
            clientId: webPushSubscriptions.clientId
          })
          .from(webPushSubscriptions)
          .where(inArray(webPushSubscriptions.clientId, clientIds))

  const clientNickname = Object.fromEntries(paired.map((p) => [p.clientId, p.pairingNickname]))

  // Group subs by nickname so we can batch sends with identical payloads.
  const byBody = new Map<string, typeof webSubs>()
  for (const s of webSubs) {
    const body = notifBody(clientNickname[s.clientId] ?? null)
    const list = byBody.get(body) ?? []
    list.push(s)
    byBody.set(body, list)
  }

  let expired: string[] = []
  const webDispatch = Promise.all(
    Array.from(byBody.entries()).map(async ([body, subs]) => {
      const result = await sendWebPush(
        subs.map((s) => ({ id: s.id, subscription: s.subscription })),
        { type: 'alert', title: notifTitle, body, data: { desktopId } }
      )
      expired = expired.concat(result)
    })
  )

  // Dispatch in parallel to Telegram. Drop pairings that the user has
  // explicitly killed (403 bot blocked) or whose chat is gone (400 chat not
  // found) — analogous to web-push 410/404 cleanup.
  const tgDispatch = Promise.all(
    tgPaired.map(async (p) => {
      const label = p.nickname ? `"${p.nickname}"` : desktopLabel
      const text = `🔔 *Focus* \\— change detected on ${escapeMarkdownV2(label)}`
      const res = photo
        ? await sendTelegramPhoto(p.chatId, photo, text)
        : await sendTelegramMessage(p.chatId, text)
      if (
        res.statusCode === 403 ||
        (res.statusCode === 400 && /chat not found/i.test(res.description ?? ''))
      ) {
        await db
          .delete(telegramPairings)
          .where(
            and(
              eq(telegramPairings.chatId, p.chatId),
              eq(telegramPairings.desktopId, desktopId)
            )
          )
        return false
      }
      return res.ok
    })
  )

  const [, tgResults] = await Promise.all([webDispatch, tgDispatch])

  if (expired.length > 0) {
    await db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.id, expired))
  }

  const tgSent = tgResults.filter(Boolean).length
  return json({ ok: true, web: webSubs.length - expired.length, telegram: tgSent })
}
