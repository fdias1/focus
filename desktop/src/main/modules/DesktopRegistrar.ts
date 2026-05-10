import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

/**
 * Registers this desktop installation with the Focus server on first launch.
 * On subsequent launches it reuses the stored desktopId + apiKey.
 * Silently skips if the server is unreachable.
 */
export async function ensureDesktopRegistered(config: ConfigStore): Promise<void> {
  const { desktopId } = config.getServerCredentials()

  // Generate a stable UUID for this installation if we don't have one yet.
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
    // Server unreachable — remote features will be unavailable until next launch.
  }
}
