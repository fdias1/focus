import { db } from '@/db'
import { desktopDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({ desktopId: z.string().uuid() })

// Idempotent: calling again with the same desktopId acknowledges registration
// but does NOT return the apiKey — it is only returned at the 201 creation.
// A desktop that loses its credentials must re-register with a fresh UUID.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId (UUID) is required')

  const { desktopId } = parsed.data

  const [existing] = await db
    .select({ id: desktopDevices.id })
    .from(desktopDevices)
    .where(eq(desktopDevices.id, desktopId))
    .limit(1)

  if (existing) return json({ desktopId: existing.id })

  const apiKey = crypto.randomUUID().replace(/-/g, '')
  await db.insert(desktopDevices).values({ id: desktopId, apiKey })
  return json({ desktopId, apiKey }, 201)
}
