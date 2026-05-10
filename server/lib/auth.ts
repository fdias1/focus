import { db } from '@/db'
import { desktopDevices } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

/**
 * Validates desktopId + apiKey from the request body object.
 * Returns the desktopId if valid, null otherwise.
 */
export async function validateDesktop(
  body: { desktopId?: string; apiKey?: string }
): Promise<string | null> {
  if (!body.desktopId || !body.apiKey) return null
  const [device] = await db
    .select()
    .from(desktopDevices)
    .where(eq(desktopDevices.id, body.desktopId))
    .limit(1)
  if (!device || device.apiKey !== body.apiKey) return null
  return device.id
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

export function err(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}
