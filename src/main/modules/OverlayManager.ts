import { BrowserWindow, screen } from 'electron'
import { Region } from './ChangeDetector'

const BORDER  = 3   // red border thickness in px
const PADDING = 10  // extra space around the tight bounding box in px
const OVERLAP_THRESHOLD = 0.9 // ignore new box if ≥90% of its area is inside an existing box

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

// Returns true if ≥ threshold of newBox's area is covered by existing.
function isSubsumedBy(newBox: Region, existing: Region, threshold = OVERLAP_THRESHOLD): boolean {
  const area = newBox.width * newBox.height
  if (area <= 0) return true
  return intersectionArea(newBox, existing) / area >= threshold
}

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
  // Exclude from desktopCapturer so the red border never appears in
  // screen snapshots and cannot cause false-positive detections.
  win.setContentProtection(true)
  win.loadURL(`data:text/html;charset=utf-8,${OVERLAY_HTML}`)
  return win
}

export class OverlayManager {
  private entries: Array<{ bbox: Region; win: BrowserWindow }> = []

  // Add boxes for newly detected regions. Any region whose area is ≥90%
  // covered by an already-visible box is silently dropped.
  add(regions: Region[]): void {
    const display = screen.getPrimaryDisplay()
    const { x: screenX, y: screenY } = display.bounds

    for (const bbox of regions) {
      if (bbox.width <= 0 || bbox.height <= 0) continue

      const duplicate = this.entries.some(
        e => !e.win.isDestroyed() && isSubsumedBy(bbox, e.bbox)
      )
      if (duplicate) continue

      const x      = screenX + Math.max(0, bbox.x - PADDING)
      const y      = screenY + Math.max(0, bbox.y - PADDING)
      const width  = Math.min(bbox.width  + PADDING * 2, display.bounds.width)
      const height = Math.min(bbox.height + PADDING * 2, display.bounds.height)

      const win = createOverlayWindow(x, y, width, height)
      const entry = { bbox, win }
      win.on('closed', () => {
        this.entries = this.entries.filter(e => e !== entry)
      })
      this.entries.push(entry)
    }
  }

  hideAll(): void {
    for (const { win } of this.entries) {
      if (!win.isDestroyed()) win.close()
    }
    this.entries = []
  }
}
