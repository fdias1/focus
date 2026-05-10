import { BrowserWindow, screen } from 'electron'
import { Region } from './ChangeDetector'

const BORDER = 3   // px — red border thickness
const PADDING = 10 // px — extra space around the tight bounding box

// Transparent, click-through, always-on-top window that draws a red
// bounding box around the region where a screen change was detected.
export class OverlayManager {
  private window: BrowserWindow | null = null

  show(bbox: Region): void {
    // bbox coordinates come from the pixel buffer which is sized to
    // display.bounds (logical pixels), so no scale-factor conversion needed.
    const display = screen.getPrimaryDisplay()
    const { x: screenX, y: screenY } = display.bounds

    const x = screenX + Math.max(0, bbox.x - PADDING)
    const y = screenY + Math.max(0, bbox.y - PADDING)
    const width  = Math.min(bbox.width  + PADDING * 2, display.bounds.width)
    const height = Math.min(bbox.height + PADDING * 2, display.bounds.height)

    if (this.window && !this.window.isDestroyed()) {
      this.window.setBounds({ x, y, width, height })
      return
    }

    this.window = new BrowserWindow({
      x, y, width, height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      roundedCorners: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

    this.window.setIgnoreMouseEvents(true)
    this.window.setAlwaysOnTop(true, 'screen-saver')

    const html = encodeURIComponent(`<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { border: ${BORDER}px solid red; }
</style></head>
<body></body>
</html>`)
    this.window.loadURL(`data:text/html;charset=utf-8,${html}`)

    this.window.on('closed', () => { this.window = null })
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
    }
    this.window = null
  }
}
