import { screen } from 'electron'

interface Region {
  x: number
  y: number
  width: number
  height: number
}

// Returns the system tray region to exclude from diff comparisons.
// macOS: top-right strip (menu bar). Windows: bottom strip (taskbar).
export function getTrayExclusionRegion(): Region {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.bounds
  const scaleFactor = display.scaleFactor

  if (process.platform === 'darwin') {
    // Menu bar: full width, top 24px (logical), right half more likely to have tray icons
    return { x: width / 2, y: 0, width: width / 2, height: Math.round(24 * scaleFactor) }
  }
  // Windows taskbar: full width, bottom 40px (logical)
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

// Returns true if the changed area (excluding tray region) exceeds sensitivityPct of the total area.
export function hasSignificantChange(
  prev: Buffer,
  curr: Buffer,
  width: number,
  height: number,
  sensitivityPct: number,
  trayRegion: Region = getTrayExclusionRegion()
): boolean {
  const bytesPerPixel = 4 // RGBA
  let changedPixels = 0
  let totalPixels = 0
  const tolerance = 30 // per-channel tolerance to ignore minor rendering noise

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixelInRegion(x, y, trayRegion)) continue
      totalPixels++
      const i = (y * width + x) * bytesPerPixel
      const dr = Math.abs(prev[i] - curr[i])
      const dg = Math.abs(prev[i + 1] - curr[i + 1])
      const db = Math.abs(prev[i + 2] - curr[i + 2])
      if (dr > tolerance || dg > tolerance || db > tolerance) {
        changedPixels++
      }
    }
  }

  if (totalPixels === 0) return false
  return (changedPixels / totalPixels) * 100 >= sensitivityPct
}
