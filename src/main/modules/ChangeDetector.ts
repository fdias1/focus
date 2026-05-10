import { screen } from 'electron'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface ChangeResult {
  changed: boolean
  bbox: Region | null // bounding box of changed pixels in logical screen coordinates
}

// Returns the system tray region to exclude from diff comparisons.
// macOS: top-right strip (menu bar). Windows: bottom strip (taskbar).
export function getTrayExclusionRegion(): Region {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.bounds
  const scaleFactor = display.scaleFactor

  if (process.platform === 'darwin') {
    return { x: width / 2, y: 0, width: width / 2, height: Math.round(24 * scaleFactor) }
  }
  return { x: 0, y: height - Math.round(40 * scaleFactor), width, height: Math.round(40 * scaleFactor) }
}

function pixelInRegion(px: number, py: number, region: Region): boolean {
  return (
    px >= region.x &&
    px < region.x + region.width &&
    py >= region.y &&
    py < region.y + region.height
  )
}

// Returns whether the changed area exceeds sensitivityPct, plus the bounding box
// of all changed pixels in the coordinate space of the supplied pixel buffer.
export function hasSignificantChange(
  prev: Buffer,
  curr: Buffer,
  width: number,
  height: number,
  sensitivityPct: number,
  trayRegion: Region = getTrayExclusionRegion()
): ChangeResult {
  const bytesPerPixel = 4 // RGBA
  const tolerance = 30    // per-channel tolerance to ignore minor rendering noise

  let changedPixels = 0
  let totalPixels = 0
  let minX = width, minY = height, maxX = 0, maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixelInRegion(x, y, trayRegion)) continue
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
