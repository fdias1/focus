import { db } from '@/db'
import { remoteSessions } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { eq, and, gt } from 'drizzle-orm'
import { z } from 'zod'
import { randomBytes } from 'crypto'

// Mobile uses this to resolve token → sessionId before it can call session-specific endpoints.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return err('token required')

  const [session] = await db
    .select()
    .from(remoteSessions)
    .where(and(eq(remoteSessions.token, token), gt(remoteSessions.expiresAt, new Date())))
    .limit(1)

  if (!session) return json({ expired: true }, 410)

  return json({
    expired: false,
    sessionId: session.id,
    displayId: session.displayId,
    desktopOffer: session.desktopOffer,
    desktopIce: JSON.parse(session.desktopIce)
  })
}

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1),
  displayId: z.number().int()
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId, apiKey, and displayId are required')

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)

  // One active session per desktop — remove any prior ones.
  await db.delete(remoteSessions).where(eq(remoteSessions.desktopId, desktopId))

  const [session] = await db
    .insert(remoteSessions)
    .values({
      desktopId,
      token,
      displayId: parsed.data.displayId,
      expiresAt
    })
    .returning({ id: remoteSessions.id })

  return json({ sessionId: session.id, token })
}
