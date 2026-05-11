import { EventEmitter } from 'events'
import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

const POLL_INTERVAL_MS = 5_000

/**
 * Polls the server for pending commands targeted at this desktop. The only
 * command currently is `startMonitoring`, triggered by `/monitor` in Telegram.
 *
 * Errors are swallowed — a failed poll just retries on the next tick. The
 * server endpoint is idempotent: it consumes the pending flag atomically, so
 * a missed response just delays delivery to the next successful poll.
 */
export class CommandPoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly config: ConfigStore) {
    super()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async poll(): Promise<void> {
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    try {
      const res = await fetch(`${SERVER_URL}/api/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desktopId, apiKey })
      })
      if (!res.ok) return
      const body = (await res.json()) as { startMonitoring?: boolean }
      if (body.startMonitoring) this.emit('startMonitoring')
    } catch {
      /* network errors are transient — try again next tick */
    }
  }
}
