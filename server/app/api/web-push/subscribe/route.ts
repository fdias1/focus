import { db } from '@/db'
import { clientDevices, webPushSubscriptions } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  clientId: z.string().uuid(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string()
    })
  })
})

const DeleteBody = z.object({
  clientId: z.string().uuid(),
  endpoint: z.string().url()
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('clientId and subscription are required')

  const { clientId, subscription } = parsed.data

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

  return json({ ok: true }, 201)
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
