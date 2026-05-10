import { db } from '@/db'
import { pairings, desktopDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  if (!clientId) return err('clientId is required')

  const rows = await db
    .select({
      id: pairings.id,
      desktopId: pairings.desktopId,
      nickname: pairings.nickname,
      createdAt: pairings.createdAt
    })
    .from(pairings)
    .where(eq(pairings.clientId, clientId))

  return json(rows)
}
