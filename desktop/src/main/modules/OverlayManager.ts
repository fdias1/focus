import { BrowserWindow, Display } from 'electron'
import { Region } from './ChangeDetector'

const BORDER  = 3
const PADDING = 10
const OVERLAP_THRESHOLD = 0.9

const OVERLAY_HTML = encodeURIComponent(`<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { border: ${BORDER}px solid red; }
</style></head>
<body></body>
</html>`)

function intersectionArea(a: Region, b: Region): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width,  b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1) return 0
  return (x2 - x1) * (y2 - y1)
}

function isSubsumedBy(newBox: Region, existing: Region): boolean {
  const area = newBox.width * newBox.height
  if (area <= 0) return true
  return intersectionArea(newBox, existing) / area >= OVERLAP_THRESHOLD
}

function createOverlayWindow(x: number, y: number, w: number, h: number): BrowserWindow {
  const win = new BrowserWindow({
    x, y, width: w, height: h,
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
  win.setContentProtection(true)
  win.loadURL(`data:text/html;charset=utf-8,${OVERLAY_HTML}`)
  return win
}

export class OverlayManager {
  private entries: Array<{ bbox: Region; win: BrowserWindow }> = []

  // bbox is in physical pixel coordinates within the display's captured frame.
  // display is used to convert to logical screen coordinates for the window.
  add(bbox: Region, display: Display): void {
    if (bbox.width <= 0 || bbox.height <= 0) return

    const sf = display.scaleFactor

    // Convert physical frame coords → logical screen coords
    const logX = display.bounds.x + Math.round((bbox.x - PADDING) / sf)
    const logY = display.bounds.y + Math.round((bbox.y - PADDING) / sf)
    const logW = Math.min(Math.round((bbox.width + PADDING * 2) / sf), display.bounds.width)
    const logH = Math.min(Math.round((bbox.height + PADDING * 2) / sf), display.bounds.height)

    // Dedup against already-visible boxes (compare in physical space)
    const duplicate = this.entries.some(
      (e) => !e.win.isDestroyed() && isSubsumedBy(bbox, e.bbox)
    )
    if (duplicate) return

    const win = createOverlayWindow(logX, logY, logW, logH)
    const entry = { bbox, win }
    win.on('closed', () => { this.entries = this.entries.filter((e) => e !== entry) })
    this.entries.push(entry)
  }

  hideAll(): void {
    for (const { win } of this.entries) {
      if (!win.isDestroyed()) win.close()
    }
    this.entries = []
  }
}
