import { db } from '@/db'
import { notifications, pairings, clientDevices } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { sendPush } from '@/lib/push'
import { eq } from 'drizzle-orm'
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

  // Dedup: skip if this bounty box was already notified
  try {
    await db.insert(notifications).values({ id: bountyBoxId, desktopId })
  } catch {
    // unique constraint violation → already sent
    return json({ ok: true, skipped: true })
  }

  // Find all paired clients with a push token
  const paired = await db
    .select({ pushToken: clientDevices.pushToken, pairingNickname: pairings.nickname })
    .from(pairings)
    .innerJoin(clientDevices, eq(pairings.clientId, clientDevices.id))
    .where(eq(pairings.desktopId, desktopId))

  const messages = paired
    .filter((p) => p.pushToken)
    .map((p) => ({
      to: p.pushToken!,
      title: 'Focus — Change detected',
      body: p.pairingNickname ? `On "${p.pairingNickname}"` : 'A change was detected on your screen.',
      data: { bountyBoxId, desktopId }
    }))

  await sendPush(messages)

  return json({ ok: true, sent: messages.length })
}
