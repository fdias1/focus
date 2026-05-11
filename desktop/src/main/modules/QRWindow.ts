import { BrowserWindow } from 'electron'
import QRCode from 'qrcode'
import { ConfigStore } from './ConfigStore'
import { ensureDesktopRegistered } from './DesktopRegistrar'
import { SERVER_URL } from './constants'

let qrWindow: BrowserWindow | null = null

async function createPairingToken(desktopId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${SERVER_URL}/api/pairing/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopId, apiKey })
    })
    if (!res.ok) return null
    const { token } = (await res.json()) as { token: string; expiresAt: string }
    return token
  } catch {
    return null
  }
}

async function waitForPairing(
  desktopId: string,
  apiKey: string,
  previousCount: number,
  signal: AbortSignal
): Promise<boolean> {
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, 3000))
    if (signal.aborted) break
    try {
      const res = await fetch(`${SERVER_URL}/api/pairings/desktop/${desktopId}`, {
        headers: { 'x-api-key': apiKey }
      })
      if (res.ok) {
        const pairings = (await res.json()) as unknown[]
        if (pairings.length > previousCount) return true
      }
    } catch {
      // ignore
    }
  }
  return false
}

export async function openQRWindow(config: ConfigStore): Promise<void> {
  // Only one QR window at a time.
  if (qrWindow && !qrWindow.isDestroyed()) {
    qrWindow.focus()
    return
  }

  // Credentials may not be ready if startup registration hasn't finished yet.
  // Try once more synchronously before giving up.
  if (!config.getServerCredentials().desktopId) {
    await ensureDesktopRegistered(config)
  }

  const { desktopId, apiKey } = config.getServerCredentials()
  if (!desktopId || !apiKey) return

  const token = await createPairingToken(desktopId, apiKey)
  if (!token) return

  // QR payload: versioned so the mobile app can parse it.
  const qrPayload = JSON.stringify({ v: 1, token, server: SERVER_URL })
  const qrSvg = await QRCode.toString(qrPayload, { type: 'svg', margin: 2 })

  const html = encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 300px; height: 360px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 16px;
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-app-region: drag;
  }
  .qr { width: 220px; height: 220px; }
  .qr svg { width: 100%; height: 100%; }
  .token {
    font-size: 28px; font-weight: 700; letter-spacing: 0.15em;
    color: #111827; font-variant-numeric: tabular-nums;
  }
  .hint { font-size: 12px; color: #6b7280; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
  <div class="qr">${qrSvg}</div>
  <div class="token">${token}</div>
  <div class="hint">Scan with Focus Client<br>or enter the code manually.<br>Expires in 5 minutes.</div>
</body>
</html>`)

  qrWindow = new BrowserWindow({
    width: 300,
    height: 360,
    resizable: false,
    frame: true,
    title: 'Pair Device',
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  qrWindow.setMenu(null)
  qrWindow.loadURL(`data:text/html;charset=utf-8,${html}`)

  // Count current pairings so we know when a new one is added.
  let previousCount = 0
  try {
    const res = await fetch(`${SERVER_URL}/api/pairings/desktop/${desktopId}`, {
      headers: { 'x-api-key': apiKey }
    })
    if (res.ok) previousCount = ((await res.json()) as unknown[]).length
  } catch { /* ignore */ }

  const controller = new AbortController()
  qrWindow.on('closed', () => {
    controller.abort()
    qrWindow = null
  })

  // Auto-close when pairing is confirmed or token expires (5 min).
  const timeout = setTimeout(() => {
    controller.abort()
    if (qrWindow && !qrWindow.isDestroyed()) qrWindow.close()
  }, 5 * 60 * 1000)

  waitForPairing(desktopId, apiKey, previousCount, controller.signal).then((paired) => {
    clearTimeout(timeout)
    if (paired && qrWindow && !qrWindow.isDestroyed()) qrWindow.close()
  })
}
