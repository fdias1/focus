import { db } from '@/db'
import { pairings, clientDevices, webPushSubscriptions } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { sendWebPush } from '@/lib/webpush'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1)
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId and apiKey are required')

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

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
  if (clientIds.length === 0) return json({ ok: true, web: 0 })

  const webSubs = await db
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
  await Promise.all(
    Array.from(byBody.entries()).map(async ([body, subs]) => {
      const result = await sendWebPush(
        subs.map((s) => ({ id: s.id, subscription: s.subscription })),
        { type: 'alert', title: notifTitle, body, data: { desktopId } }
      )
      expired = expired.concat(result)
    })
  )

  if (expired.length > 0) {
    await db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.id, expired))
  }

  return json({ ok: true, web: webSubs.length - expired.length })
}
