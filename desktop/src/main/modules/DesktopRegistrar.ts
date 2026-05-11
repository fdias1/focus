import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

// Shared promise — prevents concurrent registrations if called from both the
// startup path and the QR window path before the first one finishes.
let ongoing: Promise<void> | null = null

async function register(config: ConfigStore): Promise<void> {
  const { desktopId } = config.getServerCredentials()
  const id = desktopId ?? crypto.randomUUID()

  try {
    const res = await fetch(`${SERVER_URL}/api/desktop/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId: id })
    })
    if (!res.ok) return

    const { apiKey } = (await res.json()) as { desktopId: string; apiKey: string }
    config.setServerCredentials(id, apiKey)
  } catch {
    // Server unreachable — remote features unavailable until next call.
  }
}

/**
 * Registers this desktop installation with the Focus server on first launch.
 * On subsequent launches it reuses the stored desktopId + apiKey.
 * Concurrent calls share a single in-flight request so only one UUID is ever generated.
 */
export function ensureDesktopRegistered(config: ConfigStore): Promise<void> {
  if (!ongoing) {
    ongoing = register(config).finally(() => { ongoing = null })
  }
  return ongoing
}
