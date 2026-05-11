import { db } from '@/db'
import { pairings, desktopDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { eq } from 'drizzle-orm'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ pairingId: string }> }
) {
  const { pairingId } = await params
  const clientId = req.headers.get('x-client-id')
  const desktopId = req.headers.get('x-desktop-id')
  const apiKey = req.headers.get('x-api-key')

  if (!clientId && !desktopId) return err('missing auth headers')

  const [pairing] = await db
    .select()
    .from(pairings)
    .where(eq(pairings.id, pairingId))
    .limit(1)

  if (!pairing) return err('pairing not found', 404)

  let authorized = false
  if (clientId && pairing.clientId === clientId) {
    authorized = true
  } else if (desktopId && pairing.desktopId === desktopId && apiKey) {
    const [device] = await db
      .select({ apiKey: desktopDevices.apiKey })
      .from(desktopDevices)
      .where(eq(desktopDevices.id, desktopId))
      .limit(1)
    if (device && device.apiKey === apiKey) authorized = true
  }

  if (!authorized) return err('unauthorized', 401)

  await db.delete(pairings).where(eq(pairings.id, pairingId))
  return json({ ok: true })
}
