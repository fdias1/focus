import { db } from '@/db'
import { notifications, pairings, clientDevices, webPushSubscriptions } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { sendWebPush } from '@/lib/webpush'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1),
  bountyBoxId: z.string().uuid()
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId, apiKey and bountyBoxId are required')

  const { bountyBoxId } = parsed.data

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

  // Dedup: skip if this bounty box was already notified (conflict = duplicate).
  const inserted = await db
    .insert(notifications)
    .values({ id: bountyBoxId, desktopId })
    .onConflictDoNothing()
    .returning()
  if (inserted.length === 0) return json({ ok: true, skipped: true })

  // Find all paired clients
  const paired = await db
    .select({
      clientId: clientDevices.id,
      pairingNickname: pairings.nickname
    })
    .from(pairings)
    .innerJoin(clientDevices, eq(pairings.clientId, clientDevices.id))
    .where(eq(pairings.desktopId, desktopId))

  const notifTitle = 'Focus — Change detected'
  const notifBody = (nickname: string | null) =>
    nickname ? `On "${nickname}"` : 'A change was detected on your screen.'

  const clientIds = paired.map((p) => p.clientId)
  let webPushSent = 0

  if (clientIds.length > 0) {
    const webSubs = await db
      .select({ id: webPushSubscriptions.id, subscription: webPushSubscriptions.subscription, clientId: webPushSubscriptions.clientId })
      .from(webPushSubscriptions)
      .where(inArray(webPushSubscriptions.clientId, clientIds))

    const clientNickname = Object.fromEntries(paired.map((p) => [p.clientId, p.pairingNickname]))

    for (const sub of webSubs) {
      const expired = await sendWebPush([{ id: sub.id, subscription: sub.subscription }], {
        type: 'alert',
        title: notifTitle,
        body: notifBody(clientNickname[sub.clientId] ?? null),
        data: { bountyBoxId, desktopId }
      })
      if (expired.length > 0) {
        await db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.id, expired))
      }
      webPushSent++
    }
  }

  return json({ ok: true, web: webPushSent })
}
