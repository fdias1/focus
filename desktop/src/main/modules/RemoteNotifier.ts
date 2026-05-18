import { ConfigStore } from './ConfigStore'
import { SERVER_URL } from './constants'

export class RemoteNotifier {
  constructor(private readonly config: ConfigStore) {}

  notify(pngBuffer?: Buffer, remoteLink?: string): void {
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    const body: Record<string, unknown> = { desktopId, apiKey }
    if (pngBuffer) body.imageBase64 = pngBuffer.toString('base64')
    if (remoteLink) body.remoteLink = remoteLink

    fetch(`${SERVER_URL}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(() => {})
  }

  ackMonitor(commandIds: string[]): void {
    if (commandIds.length === 0) return
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    fetch(`${SERVER_URL}/api/monitor-ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId, apiKey, commandIds })
    }).catch(() => {})
  }

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
