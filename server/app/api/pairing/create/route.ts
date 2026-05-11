import { db } from '@/db'
import { pairingTokens } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { lt } from 'drizzle-orm'
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

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

  // Clean up expired tokens before creating a new one
  await db.delete(pairingTokens).where(lt(pairingTokens.expiresAt, new Date()))

  // Retry on collision so we never return a token bound to someone else's desktop.
  let token: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomToken()
    const inserted = await db
      .insert(pairingTokens)
      .values({ token: candidate, desktopId, expiresAt })
      .onConflictDoNothing()
      .returning({ token: pairingTokens.token })
    if (inserted.length > 0) {
      token = inserted[0].token
      break
    }
  }
  if (!token) return err('could not allocate token, retry', 503)

  return json({ token, expiresAt: expiresAt.toISOString() }, 201)
}
