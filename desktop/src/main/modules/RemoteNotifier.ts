import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

/**
 * Sends a single push notification to all paired mobile devices
 * for the given bounty box detection event.
 * Fire-and-forget — errors are silently swallowed.
 */
export class RemoteNotifier {
  constructor(private readonly config: ConfigStore) {}

  notify(bountyBoxId: string): void {
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    fetch(`${SERVER_URL}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId, apiKey, bountyBoxId })
    }).catch(() => {})
  }
}
