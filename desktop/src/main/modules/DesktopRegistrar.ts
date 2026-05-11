import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

// Shared promise — prevents concurrent registrations if called from both the
// startup path and the QR window path before the first one finishes.
let ongoing: Promise<void> | null = null

async function register(config: ConfigStore): Promise<void> {
  const stored = config.getServerCredentials()

  // If we already have both credentials, nothing to do — the server only
  // returns the apiKey at the 201 creation, so re-POSTing wouldn't recover it.
  if (stored.desktopId && stored.apiKey) return

  // Generate a fresh UUID if we have no desktopId, or if we have a desktopId
  // without an apiKey (the previous registration was partial — server thinks
  // this desktop exists but we lost the key, so we need a new identity).
  const id = (stored.desktopId && stored.apiKey) ? stored.desktopId : crypto.randomUUID()

  try {
    const res = await fetch(`${SERVER_URL}/api/desktop/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId: id })
    })
    if (res.status !== 201) return // 200 = existing without key, or error

    const { apiKey } = (await res.json()) as { desktopId: string; apiKey: string }
    if (!apiKey) return
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
