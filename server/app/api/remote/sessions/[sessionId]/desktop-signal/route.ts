import { db } from '@/db'
import { remoteSessions } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { and, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1),
  offer: z.string().optional(),
  iceCandidate: z.string().optional()
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('invalid body')

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

  const [session] = await db
    .select()
    .from(remoteSessions)
    .where(
      and(
        eq(remoteSessions.id, sessionId),
        eq(remoteSessions.desktopId, desktopId),
        gt(remoteSessions.expiresAt, new Date())
      )
    )
    .limit(1)

  if (!session) return err('session not found', 404)

  const updates: Partial<typeof remoteSessions.$inferInsert> = {}

  if (parsed.data.offer) {
    updates.desktopOffer = parsed.data.offer
  }

  if (parsed.data.iceCandidate) {
    const existing = JSON.parse(session.desktopIce) as unknown[]
    existing.push(JSON.parse(parsed.data.iceCandidate))
    updates.desktopIce = JSON.stringify(existing)
  }

  if (Object.keys(updates).length > 0) {
    await db.update(remoteSessions).set(updates).where(eq(remoteSessions.id, sessionId))
  }

  return json({ ok: true })
}
