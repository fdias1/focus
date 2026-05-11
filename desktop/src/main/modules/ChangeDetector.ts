import { screen, Display } from 'electron'
import { Region } from '../../shared/ipc-types'

export type { Region }

export interface ChangeResult {
  changed: boolean
  bbox: Region | null // bounding box of changed pixels in physical frame coordinates
}

// Returns the tray/taskbar region to exclude from diff comparisons, in physical
// pixel coordinates of the given display's captured frame.
export function getTrayExclusionRegion(display: Display): Region {
  const sf = display.scaleFactor
  const fw = Math.round(display.bounds.width * sf)   // physical frame width
  const fh = Math.round(display.bounds.height * sf)  // physical frame height

  if (process.platform === 'darwin') {
    // macOS menu bar: top strip, right half (contains clock/status items).
    return { x: Math.floor(fw / 2), y: 0, width: Math.ceil(fw / 2), height: Math.round(24 * sf) }
  }

  // Windows taskbar: bottom strip, primary display only.
  if (display.id === screen.getPrimaryDisplay().id) {
    const taskbarH = Math.round(40 * sf)
    return { x: 0, y: fh - taskbarH, width: fw, height: taskbarH }
  }

  return { x: 0, y: 0, width: 0, height: 0 } // no exclusion on secondary Windows displays
}

function pixelInRegion(px: number, py: number, r: Region): boolean {
  return px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height
}

// Returns whether the changed area exceeds sensitivityPct plus the bounding box
// of all changed pixels (in physical frame coordinates).
// watchAreas: if non-empty, only pixels within one of those regions are checked.
export function hasSignificantChange(
  prev: Buffer,
  curr: Buffer,
  width: number,
  height: number,
  sensitivityPct: number,
  trayRegion: Region,
  watchAreas: Region[] = []
): ChangeResult {
  const bytesPerPixel = 4 // BGRA (Electron bitmap format)
  const tolerance = 30    // per-channel tolerance to ignore compression/rendering noise

  let changedPixels = 0
  let totalPixels = 0
  let minX = width, minY = height, maxX = 0, maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Restrict to watch areas when configured.
      if (watchAreas.length > 0 && !watchAreas.some((wa) => pixelInRegion(x, y, wa))) continue
      // Exclude tray/taskbar area.
      if (trayRegion.width > 0 && pixelInRegion(x, y, trayRegion)) continue

      totalPixels++
      const i = (y * width + x) * bytesPerPixel
      const dr = Math.abs(prev[i]     - curr[i])
      const dg = Math.abs(prev[i + 1] - curr[i + 1])
      const db = Math.abs(prev[i + 2] - curr[i + 2])
      if (dr > tolerance || dg > tolerance || db > tolerance) {
        changedPixels++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (totalPixels === 0) return { changed: false, bbox: null }

  const changed = (changedPixels / totalPixels) * 100 >= sensitivityPct
  return {
    changed,
    bbox: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null
  }
}
