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
    .select({ clientId: clientDevices.id })
    .from(pairings)
    .innerJoin(clientDevices, eq(pairings.clientId, clientDevices.id))
    .where(eq(pairings.desktopId, desktopId))

  const clientIds = paired.map((p) => p.clientId)
  if (clientIds.length > 0) {
    const webSubs = await db
      .select({ id: webPushSubscriptions.id, subscription: webPushSubscriptions.subscription })
      .from(webPushSubscriptions)
      .where(inArray(webPushSubscriptions.clientId, clientIds))

    const expired = await sendWebPush(
      webSubs.map((s) => ({ id: s.id, subscription: s.subscription })),
      { type: 'clear', title: '', body: '', data: { desktopId } }
    )
    if (expired.length > 0) {
      await db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.id, expired))
    }
  }

  return json({ ok: true })
}
