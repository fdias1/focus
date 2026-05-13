import { db } from '@/db'
import { desktopDevices } from '@/db/schema'
import { validateDesktop, err, json } from '@/lib/auth'
import { and, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

const Body = z.object({
  desktopId: z.string().uuid(),
  apiKey: z.string().min(1)
})

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return err('desktopId and apiKey are required')

  const desktopId = await validateDesktop(parsed.data)
  if (!desktopId) return err('unauthorized', 401)

  // Atomic consume: clear pending_monitor_at and report whether it was set.
  // Same UPDATE+RETURNING pattern used elsewhere to avoid double-consume
  // when two pollers race (e.g. retry after a timeout).
  const [monCleared, relCleared] = await Promise.all([
    db
      .update(desktopDevices)
      .set({ pendingMonitorAt: null })
      .where(and(eq(desktopDevices.id, desktopId), isNotNull(desktopDevices.pendingMonitorAt)))
      .returning({ id: desktopDevices.id }),
    db
      .update(desktopDevices)
      .set({ pendingReleaseAt: null })
      .where(and(eq(desktopDevices.id, desktopId), isNotNull(desktopDevices.pendingReleaseAt)))
      .returning({ id: desktopDevices.id })
  ])

  return json({ startMonitoring: monCleared.length > 0, stopMonitoring: relCleared.length > 0 })
}
