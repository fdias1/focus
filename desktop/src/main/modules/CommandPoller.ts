import { EventEmitter } from 'events'
import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

const POLL_INTERVAL_MS = 5_000

/**
 * Polls the server for pending commands targeted at this desktop. Commands
 * are issued by the Telegram bot (e.g. /monitor, /release) and consumed
 * atomically server-side, so a successful poll delivers exactly once.
 *
 * Emits:
 *   - 'startMonitoring' (commandIds: string[]) — desktop must enter monitor
 *     mode and ack each commandId via RemoteNotifier.ackMonitor() once it
 *     does. An empty array means "force monitor without confirmation"
 *     (legacy /monitor signal).
 *   - 'stopMonitoring' — desktop must enter OFF mode.
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
      const body = (await res.json()) as {
        startMonitoring?: boolean
        stopMonitoring?: boolean
        monitorCommandIds?: string[]
      }
      const ids = body.monitorCommandIds ?? []
      if (body.startMonitoring || ids.length > 0) this.emit('startMonitoring', ids)
      if (body.stopMonitoring) this.emit('stopMonitoring')
    } catch {
      /* network errors are transient — try again next tick */
    }
  }
}
