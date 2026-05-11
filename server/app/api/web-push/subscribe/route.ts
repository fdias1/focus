import { db } from '@/db'
import { clientDevices, desktopNotifications, pairings, webPushSubscriptions } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  clientId: z.string().uuid(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string()
    })
  }),
  // ISO timestamp — return any notifications sent after this point (max 24 h).
  since: z.string().datetime({ offset: true }).optional()
})

const DeleteBody = z.object({
  clientId: z.string().uuid(),
  endpoint: z.string().url()
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('clientId and subscription are required')

  const { clientId, subscription, since } = parsed.data

  // Self-heal: race with /api/client/register on first PWA load. Create the
  // client row if missing instead of 404'ing.
  await db.insert(clientDevices).values({ id: clientId }).onConflictDoNothing()

  // Upsert: unique constraint on (clientId, endpoint) prevents duplicate rows even
  // under concurrent requests. On conflict we update the subscription JSON to handle
  // browser-side key rotation where the endpoint stays the same but keys change.
  await db
    .insert(webPushSubscriptions)
    .values({ clientId, endpoint: subscription.endpoint, subscription: JSON.stringify(subscription) })
    .onConflictDoUpdate({
      target: [webPushSubscriptions.clientId, webPushSubscriptions.endpoint],
      set: { subscription: JSON.stringify(subscription) }
    })

  // If the client sends a `since` timestamp, return any notifications that were
  // sent to paired desktops after that point (capped at 24 h) so the caller can
  // surface notifications that arrived while the subscription was invalid.
  let missed: { id: string; title: string; body: string; desktopId: string; sentAt: string }[] = []

  if (since) {
    const paired = await db
      .select({ desktopId: pairings.desktopId, nickname: pairings.nickname })
      .from(pairings)
      .where(eq(pairings.clientId, clientId))

    if (paired.length > 0) {
      const desktopIds = paired.map((p) => p.desktopId)
      const window24h = sql`now() - interval '24 hours'`
      // Use whichever is more recent: `since` or 24 h ago
      const sinceDate = new Date(since)
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const effectiveSince = sinceDate > cutoff24h ? sinceDate : cutoff24h

      const records = await db
        .select()
        .from(desktopNotifications)
        .where(
          and(
            inArray(desktopNotifications.desktopId, desktopIds),
            gt(desktopNotifications.sentAt, effectiveSince),
            gt(desktopNotifications.sentAt, sql`${window24h}`)
          )
        )
        .orderBy(asc(desktopNotifications.sentAt))

      const nicknameMap = Object.fromEntries(paired.map((p) => [p.desktopId, p.nickname]))
      const label = (id: string) => `Desktop ${id.slice(0, 8)}`
      const body = (desktopId: string) => {
        const nick = nicknameMap[desktopId]
        return `On ${nick ? `"${nick}"` : label(desktopId)}`
      }

      missed = records.map((r) => ({
        id: r.id,
        title: r.title,
        body: body(r.desktopId),
        desktopId: r.desktopId,
        sentAt: r.sentAt.toISOString()
      }))
    }
  }

  return json({ ok: true, missed }, 201)
}

export async function DELETE(req: Request) {
  const parsed = DeleteBody.safeParse(await req.json())
  if (!parsed.success) return err('clientId and endpoint are required')

  const { clientId, endpoint } = parsed.data

  await db
    .delete(webPushSubscriptions)
    .where(and(eq(webPushSubscriptions.clientId, clientId), eq(webPushSubscriptions.endpoint, endpoint)))

  return json({ ok: true })
}
