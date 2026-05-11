import { db } from '@/db'
import { pairingTokens, pairings, clientDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { and, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  token: z.string().min(1),
  clientId: z.string().uuid(),
  nickname: z.string().max(64).optional()
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('token and clientId are required')

  const { token, clientId, nickname } = parsed.data

  // Note: we can't wrap the steps below in a transaction because the
  // @neondatabase/serverless HTTP driver doesn't support them
  // ("No transactions support in neon-http driver"). The atomicity that
  // actually matters — no two clients consuming the same token — is
  // guaranteed by the DELETE...RETURNING below. The downside is that if a
  // subsequent insert fails, the token is gone and the user must request a
  // new QR; acceptable given how rare DB errors are here.

  // Atomic consume — DELETE+RETURNING prevents concurrent double-consume.
  const [pt] = await db
    .delete(pairingTokens)
    .where(and(eq(pairingTokens.token, token), gt(pairingTokens.expiresAt, new Date())))
    .returning()
  if (!pt) return err('invalid or expired token', 404)

  await db.insert(clientDevices).values({ id: clientId }).onConflictDoNothing()

  let [pairing] = await db
    .insert(pairings)
    .values({ desktopId: pt.desktopId, clientId, nickname: nickname ?? null })
    .onConflictDoNothing()
    .returning()

  if (!pairing) {
    ;[pairing] = await db
      .select()
      .from(pairings)
      .where(and(eq(pairings.desktopId, pt.desktopId), eq(pairings.clientId, clientId)))
      .limit(1)
  }

  return json({ pairingId: pairing?.id ?? null, desktopId: pt.desktopId }, 201)
}
