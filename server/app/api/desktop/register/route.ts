import { db } from '@/db'
import { desktopDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({ desktopId: z.string().uuid() })

// Idempotent: calling again with the same desktopId returns the existing record.
// The apiKey is only returned on first creation.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId (UUID) is required')

  const { desktopId } = parsed.data

  const [existing] = await db
    .select()
    .from(desktopDevices)
    .where(eq(desktopDevices.id, desktopId))
    .limit(1)

  if (existing) return json({ desktopId: existing.id, apiKey: existing.apiKey })

  const apiKey = crypto.randomUUID().replace(/-/g, '')
  await db.insert(desktopDevices).values({ id: desktopId, apiKey })
  return json({ desktopId, apiKey }, 201)
}
