import { db } from '@/db'
import { clientDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({ clientId: z.string().uuid() })

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('clientId (UUID) is required')

  const { clientId } = parsed.data

  const [existing] = await db
    .select()
    .from(clientDevices)
    .where(eq(clientDevices.id, clientId))
    .limit(1)

  if (existing) return json({ clientId: existing.id })

  await db.insert(clientDevices).values({ id: clientId })
  return json({ clientId }, 201)
}
