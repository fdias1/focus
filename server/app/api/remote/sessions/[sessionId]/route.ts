import { db } from '@/db'
import { remoteSessions } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { and, eq, gt } from 'drizzle-orm'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return err('token required')

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

  if (!session) return json({ expired: true }, 410)

  return json({
    expired: false,
    displayId: session.displayId,
    desktopOffer: session.desktopOffer,
    desktopIce: JSON.parse(session.desktopIce)
  })
}
