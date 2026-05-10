import { db } from '@/db'
import { pairingTokens, pairings, clientDevices } from '@/db/schema'
import { err, json } from '@/lib/auth'
import { and, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  token: z.string().min(1),
  clientId: z.string().uuid(),
  pushToken: z.string().optional(),
  nickname: z.string().max(64).optional()
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('token and clientId are required')

  const { token, clientId, pushToken, nickname } = parsed.data

  // Validate token and check expiry
  const [pt] = await db
    .select()
    .from(pairingTokens)
    .where(and(eq(pairingTokens.token, token), gt(pairingTokens.expiresAt, new Date())))
    .limit(1)

  if (!pt) return err('invalid or expired token', 404)

  // Ensure client is registered; upsert so the client can also set push token here
  await db
    .insert(clientDevices)
    .values({ id: clientId, pushToken: pushToken ?? null })
    .onConflictDoUpdate({
      target: clientDevices.id,
      set: { pushToken: pushToken ?? null }
    })

  // Create pairing (ignore if already paired)
  const [pairing] = await db
    .insert(pairings)
    .values({ desktopId: pt.desktopId, clientId, nickname: nickname ?? null })
    .onConflictDoNothing()
    .returning()

  // Consume the token
  await db.delete(pairingTokens).where(eq(pairingTokens.token, token))

  return json({ pairingId: pairing?.id ?? null, desktopId: pt.desktopId }, 201)
}
