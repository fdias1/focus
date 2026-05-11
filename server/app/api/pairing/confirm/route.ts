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

  // All-or-nothing: if any step fails the token is preserved for retry.
  // Neon HTTP supports db.transaction() as a single batched request.
  const result = await db.transaction(async (tx) => {
    // Atomic consume — DELETE+RETURNING prevents concurrent double-consume.
    const [pt] = await tx
      .delete(pairingTokens)
      .where(and(eq(pairingTokens.token, token), gt(pairingTokens.expiresAt, new Date())))
      .returning()
    if (!pt) return null

    await tx.insert(clientDevices).values({ id: clientId }).onConflictDoNothing()

    let [pairing] = await tx
      .insert(pairings)
      .values({ desktopId: pt.desktopId, clientId, nickname: nickname ?? null })
      .onConflictDoNothing()
      .returning()

    if (!pairing) {
      ;[pairing] = await tx
        .select()
        .from(pairings)
        .where(and(eq(pairings.desktopId, pt.desktopId), eq(pairings.clientId, clientId)))
        .limit(1)
    }

    return { pairingId: pairing?.id ?? null, desktopId: pt.desktopId }
  })

  if (!result) return err('invalid or expired token', 404)
  return json(result, 201)
}
