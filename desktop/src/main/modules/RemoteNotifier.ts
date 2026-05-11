import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

/**
 * Sends push events to all paired mobile/web clients.
 * All calls are fire-and-forget — errors are silently swallowed.
 */
export class RemoteNotifier {
  constructor(private readonly config: ConfigStore) {}

  /** Notify paired devices that a screen change was detected. */
  notify(): void {
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    fetch(`${SERVER_URL}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId, apiKey })
    }).catch(() => {})
  }

  /** Notify paired devices that the user is active again — clears their notification list. */
  clear(): void {
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    fetch(`${SERVER_URL}/api/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId, apiKey })
    }).catch(() => {})
  }
}
