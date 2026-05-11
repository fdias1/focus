import { db } from '@/db'
import { clientDevices, webPushSubscriptions } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'
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

  // Ensure client exists
  const [client] = await db
    .select({ id: clientDevices.id })
    .from(clientDevices)
    .where(eq(clientDevices.id, clientId))
    .limit(1)
  if (!client) return err('client not found', 404)

  await db
    .insert(webPushSubscriptions)
    .values({ clientId, subscription: JSON.stringify(subscription) })
    .onConflictDoNothing()

  return json({ ok: true }, 201)
}

export async function DELETE(req: Request) {
  const parsed = DeleteBody.safeParse(await req.json())
  if (!parsed.success) return err('clientId and endpoint are required')

  // We can't filter by endpoint directly since subscription is stored as JSON text,
  // so load all subs for the client and delete the matching one.
  const { clientId, endpoint } = parsed.data

  const rows = await db
    .select()
    .from(webPushSubscriptions)
    .where(eq(webPushSubscriptions.clientId, clientId))

  const match = rows.find((r) => {
    try {
      return JSON.parse(r.subscription).endpoint === endpoint
    } catch {
      return false
    }
  })

  if (match) {
    await db
      .delete(webPushSubscriptions)
      .where(eq(webPushSubscriptions.id, match.id))
  }

  return json({ ok: true })
}
