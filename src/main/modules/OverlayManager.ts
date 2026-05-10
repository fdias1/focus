import { BrowserWindow, screen } from 'electron'
import { Region } from './ChangeDetector'

const BORDER  = 3   // red border thickness in px
const PADDING = 10  // extra space around the tight bounding box in px

const OVERLAY_HTML = encodeURIComponent(`<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { border: ${BORDER}px solid red; }
</style></head>
<body></body>
</html>`)

function createOverlayWindow(x: number, y: number, width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
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
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  // Exclude this window from desktopCapturer so it never appears in
  // screen snapshots and cannot cause false-positive change detections.
  win.setContentProtection(true)
  win.loadURL(`data:text/html;charset=utf-8,${OVERLAY_HTML}`)
  return win
}

export class OverlayManager {
  private windows: BrowserWindow[] = []

  // Hide and destroy all current overlay windows before a new scan.
  hideAll(): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) win.close()
    }
    this.windows = []
  }

  // Show one bounty-box per detected region. Clears previous boxes first.
  showAll(regions: Region[]): void {
    this.hideAll()

    const display = screen.getPrimaryDisplay()
    const { x: screenX, y: screenY } = display.bounds

    for (const bbox of regions) {
      if (bbox.width <= 0 || bbox.height <= 0) continue

      const x      = screenX + Math.max(0, bbox.x - PADDING)
      const y      = screenY + Math.max(0, bbox.y - PADDING)
      const width  = Math.min(bbox.width  + PADDING * 2, display.bounds.width)
      const height = Math.min(bbox.height + PADDING * 2, display.bounds.height)

      const win = createOverlayWindow(x, y, width, height)
      win.on('closed', () => {
        this.windows = this.windows.filter(w => w !== win)
      })
      this.windows.push(win)
    }
  }
}
