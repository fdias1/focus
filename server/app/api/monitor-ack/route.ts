import { db } from '@/db'
import { monitorCommands } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1),
  commandIds: z.array(z.string().uuid()).min(1)
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId, apiKey and commandIds[] are required')

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

  // Scope the update to this desktop so a compromised desktopId cannot
  // confirm commands targeted at someone else's desktop.
  const updated = await db
    .update(monitorCommands)
    .set({ state: 'confirmed', confirmedAt: new Date() })
    .where(
      and(
        eq(monitorCommands.desktopId, desktopId),
        inArray(monitorCommands.id, parsed.data.commandIds)
      )
    )
    .returning({ id: monitorCommands.id })

  return json({ ok: true, confirmed: updated.length })
}
