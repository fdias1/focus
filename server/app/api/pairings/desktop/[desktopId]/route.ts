import { db } from '@/db'
import { pairings } from '@/db/schema'
import { err, json, validateDesktop } from '@/lib/auth'
import { eq } from 'drizzle-orm'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ desktopId: string }> }
) {
  const { desktopId } = await params
  const apiKey = req.headers.get('x-api-key') ?? ''

  const validId = await validateDesktop({ desktopId, apiKey })
  if (!validId) return err('unauthorized', 401)

  const rows = await db
    .select({
      id: pairings.id,
      clientId: pairings.clientId,
      nickname: pairings.nickname,
      createdAt: pairings.createdAt
    })
    .from(pairings)
    .where(eq(pairings.desktopId, desktopId))

  return json(rows)
}
