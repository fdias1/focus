import { db } from '@/db'
import { clientDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  clientId: z.string().uuid(),
  pushToken: z.string().min(1)
})

export async function PATCH(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('clientId and pushToken are required')

  const { clientId, pushToken } = parsed.data

  const result = await db
    .update(clientDevices)
    .set({ pushToken })
    .where(eq(clientDevices.id, clientId))
    .returning({ id: clientDevices.id })

  if (result.length === 0) return err('client not found', 404)
  return json({ ok: true })
}
