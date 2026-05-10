import { db } from '@/db'
import { pairingTokens } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { z } from 'zod'

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1)
})

function randomToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => chars[b % chars.length])
    .join('')
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId and apiKey are required')

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

  const token = randomToken()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

  // Clean up expired tokens for this desktop before creating a new one
  await db.delete(pairingTokens).where(
    // @ts-expect-error: drizzle lt on timestamp
    (t: typeof pairingTokens) => t.expiresAt < new Date()
  )

  await db
    .insert(pairingTokens)
    .values({ token, desktopId, expiresAt })
    .onConflictDoNothing()

  return json({ token, expiresAt: expiresAt.toISOString() }, 201)
}
