import { db } from '@/db'
import { remoteSessions } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { and, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

// Desktop polls for the mobile answer + ICE candidates.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const url = new URL(req.url)
  const desktopId = url.searchParams.get('desktopId')
  const apiKey = url.searchParams.get('apiKey')

  const validatedId = await validateDesktop({ desktopId: desktopId ?? undefined, apiKey: apiKey ?? undefined })
  if (!validatedId) return err('unauthorized', 401)

  const [session] = await db
    .select()
    .from(remoteSessions)
    .where(
      and(
        eq(remoteSessions.id, sessionId),
        eq(remoteSessions.desktopId, validatedId),
        gt(remoteSessions.expiresAt, new Date())
      )
    )
    .limit(1)

  if (!session) return err('session not found', 404)

  return json({
    mobileAnswer: session.mobileAnswer,
    mobileIce: JSON.parse(session.mobileIce)
  })
}

const MobileBody = z.object({
  answer: z.string().optional(),
  iceCandidate: z.string().optional()
})

// Mobile posts its answer + ICE candidates (authenticated via token querystring).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return err('token required')

  const parsed = MobileBody.safeParse(await req.json())
  if (!parsed.success) return err('invalid body')

  const [session] = await db
    .select()
    .from(remoteSessions)
    .where(
      and(
        eq(remoteSessions.id, sessionId),
        eq(remoteSessions.token, token),
        gt(remoteSessions.expiresAt, new Date())
      )
    )
    .limit(1)

  if (!session) return err('session not found or expired', 404)

  const updates: Partial<typeof remoteSessions.$inferInsert> = {}

  if (parsed.data.answer) {
    updates.mobileAnswer = parsed.data.answer
  }

  if (parsed.data.iceCandidate) {
    const existing = JSON.parse(session.mobileIce) as unknown[]
    existing.push(JSON.parse(parsed.data.iceCandidate))
    updates.mobileIce = JSON.stringify(existing)
  }

  if (Object.keys(updates).length > 0) {
    await db.update(remoteSessions).set(updates).where(eq(remoteSessions.id, sessionId))
  }

  return json({ ok: true })
}
