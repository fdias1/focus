import { db } from '@/db'
import { pairings } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  clientId: z.string().uuid().optional(),
  desktopId: z.string().uuid().optional(),
  apiKey: z.string().optional()
})

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ pairingId: string }> }
) {
  const { pairingId } = await params
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('invalid body')

  const { clientId, desktopId } = parsed.data

  const [pairing] = await db
    .select()
    .from(pairings)
    .where(eq(pairings.id, pairingId))
    .limit(1)

  if (!pairing) return err('pairing not found', 404)

  // Caller must own one side of the pairing
  const authorized =
    (clientId && pairing.clientId === clientId) ||
    (desktopId && pairing.desktopId === desktopId)

  if (!authorized) return err('unauthorized', 401)

  await db.delete(pairings).where(eq(pairings.id, pairingId))
  return json({ ok: true })
}
