import { screen, Display } from 'electron'
import { Region } from '../../shared/ipc-types'

export type { Region }

const CHUNK_PX = 10  // physical pixels per chunk side

export interface ChunkGrid {
  cols: number        // Math.ceil(frameWidth  / CHUNK_PX)
  rows: number        // Math.ceil(frameHeight / CHUNK_PX)
  active: Uint8Array  // length = cols * rows; 1 = has changed pixels, 0 = unchanged
}

export interface ChangeResult {
  changed: boolean
  grid: ChunkGrid | null
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

function rectsIntersect(ax: number, ay: number, aw: number, ah: number, r: Region): boolean {
  return ax < r.x + r.width && ax + aw > r.x && ay < r.y + r.height && ay + ah > r.y
}

// Divides the frame into a 100×100 grid of equal chunks.
// A chunk is "active" if at least one of its pixels changed beyond the tolerance
// (and passes watch-area / tray-exclusion filters).
// sensitivityPct: alarm fires when (active chunks / relevant chunks) * 100 >= this value.
export function hasSignificantChange(
  prev: Buffer,
  curr: Buffer,
  width: number,
  height: number,
  sensitivityPct: number,
  trayRegion: Region,
  watchAreas: Region[] = []
): ChangeResult {
  const bytesPerPixel = 4   // BGRA
  const tolerance = 30

  const cols = Math.ceil(width  / CHUNK_PX)
  const rows = Math.ceil(height / CHUNK_PX)

  const active = new Uint8Array(cols * rows)
  let changedChunks = 0
  let relevantChunks = 0

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = gx * CHUNK_PX
      const y0 = gy * CHUNK_PX
      const x1 = Math.min(x0 + CHUNK_PX, width)
      const y1 = Math.min(y0 + CHUNK_PX, height)
      const cw = x1 - x0
      const ch = y1 - y0

      // Skip chunk entirely if it falls outside watch areas (when configured).
      if (watchAreas.length > 0 && !watchAreas.some((wa) => rectsIntersect(x0, y0, cw, ch, wa))) continue

      // Skip chunk entirely if it is fully inside the tray exclusion region.
      if (trayRegion.width > 0 && rectsIntersect(x0, y0, cw, ch, trayRegion)) continue

      relevantChunks++

      // Scan pixels in this chunk to find any change.
      outer: for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (watchAreas.length > 0 && !watchAreas.some((wa) => pixelInRegion(x, y, wa))) continue
          if (trayRegion.width > 0 && pixelInRegion(x, y, trayRegion)) continue

          const i = (y * width + x) * bytesPerPixel
          if (
            Math.abs(prev[i]     - curr[i])     > tolerance ||
            Math.abs(prev[i + 1] - curr[i + 1]) > tolerance ||
            Math.abs(prev[i + 2] - curr[i + 2]) > tolerance
          ) {
            active[gy * cols + gx] = 1
            changedChunks++
            break outer
          }
        }
      }
    }
  }

  if (relevantChunks === 0) return { changed: false, grid: null }

  const changed = (changedChunks / relevantChunks) * 100 >= sensitivityPct
  return {
    changed,
    grid: changed ? { cols, rows, active } : null
  }
}
