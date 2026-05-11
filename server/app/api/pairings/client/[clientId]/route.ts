import { db } from '@/db'
import { pairings, desktopDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  if (!clientId) return err('clientId is required')

  // Caller must echo their own clientId in a header. Doesn't add cryptographic
  // strength (both values come from the same client) but blocks trivial
  // enumeration via stray URLs / logs.
  const echoed = req.headers.get('x-client-id')
  if (echoed !== clientId) return err('unauthorized', 401)

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
