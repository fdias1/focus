import { db } from '@/db'
import { pairings, clientDevices, webPushSubscriptions } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { sendWebPush } from '@/lib/webpush'
import { sendPush } from '@/lib/push'
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

  // Find all paired clients
  const paired = await db
    .select({ clientId: clientDevices.id, pushToken: clientDevices.pushToken, nickname: pairings.nickname })
    .from(pairings)
    .innerJoin(clientDevices, eq(pairings.clientId, clientDevices.id))
    .where(eq(pairings.desktopId, desktopId))

  // Expo push — send a data-only message to clear the badge/list
  const expoMessages = paired
    .filter((p) => p.pushToken)
    .map((p) => ({
      to: p.pushToken!,
      title: '',
      body: '',
      data: { type: 'clear', desktopId }
    }))
  await sendPush(expoMessages)

  // Web push — send a silent clear payload
  const clientIds = paired.map((p) => p.clientId)
  if (clientIds.length > 0) {
    const webSubs = await db
      .select({ subscription: webPushSubscriptions.subscription })
      .from(webPushSubscriptions)
      .where(inArray(webPushSubscriptions.clientId, clientIds))

    await sendWebPush(
      webSubs.map((s) => s.subscription),
      { title: '', body: '', data: { type: 'clear', desktopId } }
    )
  }

  return json({ ok: true })
}
