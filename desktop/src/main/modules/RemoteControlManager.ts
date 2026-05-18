import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'

type IceCandidate = Record<string, unknown>
import { join } from 'path'
import { ConfigStore } from './ConfigStore'
import { InputInjector } from './InputInjector'
import { SERVER_URL } from './constants'
import type { RemoteInputEvent } from '../../preload/remote-peer'

const POLL_MS = 700

interface RemoteSession {
  sessionId: string
  token: string
  displayId: number
}

export class RemoteControlManager {
  private window: BrowserWindow | null = null
  private session: RemoteSession | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private mobileIceApplied = 0
  private readonly injector = new InputInjector()

  constructor(private readonly config: ConfigStore) {
    ipcMain.on('focus:remote-input', (_ev, event: RemoteInputEvent) => {
      this.onInput(event)
    })
    ipcMain.on('focus:remote-peer-offer', (_ev, sdp: string) => {
      this.onPeerOffer(sdp)
    })
    ipcMain.on('focus:remote-peer-local-ice', (_ev, candidate: string) => {
      this.onLocalIce(candidate)
    })
    ipcMain.on('focus:remote-peer-closed', () => {
      this.stopSession()
    })
  }

  /**
   * Creates a remote session for the given display, starts the hidden renderer,
   * and returns the token to include in the Telegram link.
   * Returns null if credentials are not set or the request fails.
   */
  async startSession(displayId: number): Promise<string | null> {
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return null

    // If a session is already active for the same display, reuse the token.
    if (this.session && this.session.displayId === displayId && this.window && !this.window.isDestroyed()) {
      return this.session.token
    }

    this.stopSession()

    try {
      const res = await fetch(`${SERVER_URL}/api/remote/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desktopId, apiKey, displayId })
      })
      if (!res.ok) return null
      const data = await res.json() as { sessionId: string; token: string }
      this.session = { sessionId: data.sessionId, token: data.token, displayId }
    } catch {
      return null
    }

    // Find the desktopCapturer source that matches this display.
    const displays = screen.getAllDisplays()
    const display = displays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
    const maxW = Math.max(...displays.map((d) => d.bounds.width * d.scaleFactor))
    const maxH = Math.max(...displays.map((d) => d.bounds.height * d.scaleFactor))

    let sourceId: string | null = null
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: maxW, height: maxH }
      })
      const source =
        sources.find((s) => s.display_id === String(display.id)) ??
        sources.find((s) => {
          const sz = s.thumbnail.getSize()
          return (
            sz.width === Math.round(display.bounds.width * display.scaleFactor) &&
            sz.height === Math.round(display.bounds.height * display.scaleFactor)
          )
        }) ??
        sources[0]
      sourceId = source?.id ?? null
    } catch {
      return null
    }

    if (!sourceId) return null

    this.createWindow(sourceId)
    return this.session.token
  }

  stopSession(): void {
    this.clearPoll()
    this.mobileIceApplied = 0
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('focus:remote-peer-stop')
      setTimeout(() => {
        if (this.window && !this.window.isDestroyed()) this.window.destroy()
        this.window = null
      }, 500)
    } else {
      this.window = null
    }
    this.session = null
  }

  private createWindow(displaySourceId: string): void {
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/remote-peer.js'),
        sandbox: false,
        contextIsolation: true
      }
    })

    this.window.on('closed', () => { this.window = null })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      this.window.loadURL(`${devUrl}/remote-peer/index.html`)
    } else {
      this.window.loadFile(join(__dirname, '../renderer/remote-peer/index.html'))
    }

    this.window.webContents.once('did-finish-load', () => {
      this.window?.webContents.send('focus:remote-peer-start', { displaySourceId })
    })
  }

  private onPeerOffer(sdp: string): void {
    if (!this.session) return
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    const { sessionId } = this.session
    fetch(`${SERVER_URL}/api/remote/sessions/${sessionId}/desktop-signal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId, apiKey, offer: sdp })
    }).catch(() => {})

    // Start polling for mobile answer + ICE candidates.
    this.clearPoll()
    this.schedulePoll()
  }

  private onLocalIce(candidate: string): void {
    if (!this.session) return
    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    fetch(`${SERVER_URL}/api/remote/sessions/${this.session.sessionId}/desktop-signal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId, apiKey, iceCandidate: candidate })
    }).catch(() => {})
  }

  private schedulePoll(): void {
    this.pollTimer = setTimeout(() => this.poll(), POLL_MS)
  }

  private clearPoll(): void {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null }
  }

  private async poll(): Promise<void> {
    if (!this.session || !this.window || this.window.isDestroyed()) return

    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    const { sessionId } = this.session
    try {
      const res = await fetch(
        `${SERVER_URL}/api/remote/sessions/${sessionId}/mobile-signal?desktopId=${encodeURIComponent(desktopId)}&apiKey=${encodeURIComponent(apiKey)}`
      )
      if (!res.ok) { this.schedulePoll(); return }

      const data = await res.json() as { mobileAnswer?: string; mobileIce?: IceCandidate[] }

      if (data.mobileAnswer && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('focus:remote-peer-answer', data.mobileAnswer)
        // Stop polling for the answer after it's been applied once.
        this.clearPoll()
        // Continue polling only for new ICE candidates.
        this.pollTimer = setTimeout(() => this.pollIceOnly(), POLL_MS)
        return
      }
    } catch { /* retry */ }

    this.schedulePoll()
  }

  private async pollIceOnly(): Promise<void> {
    if (!this.session || !this.window || this.window.isDestroyed()) return

    const { desktopId, apiKey } = this.config.getServerCredentials()
    if (!desktopId || !apiKey) return

    const { sessionId } = this.session
    try {
      const res = await fetch(
        `${SERVER_URL}/api/remote/sessions/${sessionId}/mobile-signal?desktopId=${encodeURIComponent(desktopId)}&apiKey=${encodeURIComponent(apiKey)}`
      )
      if (res.ok) {
        const data = await res.json() as { mobileIce?: IceCandidate[] }
        const candidates = data.mobileIce ?? []
        for (let i = this.mobileIceApplied; i < candidates.length; i++) {
          this.window?.webContents.send('focus:remote-peer-remote-ice', JSON.stringify(candidates[i]))
          this.mobileIceApplied = i + 1
        }
      }
    } catch { /* retry */ }

    // Keep polling for more ICE candidates until we have a connection.
    if (this.window && !this.window.isDestroyed()) {
      this.pollTimer = setTimeout(() => this.pollIceOnly(), POLL_MS)
    }
  }

  private onInput(event: RemoteInputEvent): void {
    if (!this.session) return
    const displays = screen.getAllDisplays()
    const display =
      displays.find((d) => d.id === this.session!.displayId) ?? screen.getPrimaryDisplay()

    if (event.type === 'click' && event.xFrac !== undefined && event.yFrac !== undefined) {
      this.injector
        .click(event.xFrac, event.yFrac, event.button ?? 'left', display)
        .catch(() => {})
    } else if (event.type === 'type' && event.text) {
      this.injector.typeText(event.text).catch(() => {})
    } else if (event.type === 'key' && event.key) {
      this.injector.pressKey(event.key).catch(() => {})
    }
  }
}
