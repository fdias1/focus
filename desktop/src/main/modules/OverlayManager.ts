import { BrowserWindow, Display } from 'electron'
import { ChunkGrid } from './ChangeDetector'

// A 1×1 fully-inactive grid — used to create a solid-dark overlay on a display
// that has no detected changes (e.g. non-triggering displays in a multi-monitor setup).
const DARK_GRID: ChunkGrid = { cols: 1, rows: 1, active: new Uint8Array(1) }

// One full-screen overlay window per display.
// Active chunks (changed pixels) are left transparent; inactive chunks receive a
// dark 30 % opacity overlay, so only the areas that actually changed remain visible.

const OVERLAY_HTML = encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  var c = document.getElementById('c');
  var ctx = c.getContext('2d');

  // cols/rows are passed each call because chunk count depends on physical resolution.
  window.drawGrid = function(cols, rows, active) {
    c.width  = window.innerWidth;
    c.height = window.innerHeight;
    var cw = c.width  / cols;
    var ch = c.height / rows;
    // Fill everything dark first, then cut out the active chunks.
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.clearRect(0, 0, 0, 0); // no-op, just keeps intent clear
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    for (var i = 0; i < active.length; i++) {
      if (active[i]) {
        var col = i % cols;
        var row = Math.floor(i / cols);
        // Use exact floats so adjacent chunks share an edge with no gap or overlap.
        var x0 = col * cw, y0 = row * ch;
        ctx.fillRect(x0, y0, (col + 1) * cw - x0, (row + 1) * ch - y0);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  };
</script>
</body>
</html>`)

function createOverlayWindow(display: Display): BrowserWindow {
  const { x, y, width, height } = display.bounds
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
  win.setContentProtection(true)
  return win
}

interface Entry {
  win: BrowserWindow
  cols: number
  rows: number
  // Cumulative OR of all grids received since alarm started.
  active: Uint8Array
  // True once the window has finished loading and drawGrid is callable.
  ready: boolean
  // Grid pending draw if the window wasn't ready yet.
  pendingDraw: boolean
}

export class OverlayManager {
  private entries = new Map<number, Entry>()

  // grid is in logical chunk coordinates (100 × 100) regardless of scaleFactor.
  // display is needed to position and size the window.
  update(grid: ChunkGrid, display: Display): void {
    let entry = this.entries.get(display.id)

    if (!entry) {
      const win = createOverlayWindow(display)
      const active = new Uint8Array(grid.cols * grid.rows)
      entry = { win, cols: grid.cols, rows: grid.rows, active, ready: false, pendingDraw: false }
      this.entries.set(display.id, entry)

      win.loadURL(`data:text/html;charset=utf-8,${OVERLAY_HTML}`)

      win.webContents.once('did-finish-load', () => {
        const e = this.entries.get(display.id)
        if (!e || e.win.isDestroyed()) return
        e.ready = true
        if (e.pendingDraw) this.redraw(e)
      })

      win.on('closed', () => this.entries.delete(display.id))
    }

    // Accumulate: once a chunk is active it stays active until hideAll().
    // If resolution changed and grid dimensions differ, reset the buffer.
    if (entry.cols !== grid.cols || entry.rows !== grid.rows) {
      entry.cols = grid.cols
      entry.rows = grid.rows
      entry.active = new Uint8Array(grid.cols * grid.rows)
    }
    for (let i = 0; i < grid.active.length; i++) {
      if (grid.active[i]) entry.active[i] = 1
    }

    if (entry.ready) {
      this.redraw(entry)
    } else {
      entry.pendingDraw = true
    }
  }

  // Creates a fully-dark overlay on a display that has no active chunks.
  // No-op if an overlay already exists for this display.
  darken(display: Display): void {
    if (!this.entries.has(display.id)) {
      this.update(DARK_GRID, display)
    }
  }

  hideAll(): void {
    for (const { win } of this.entries.values()) {
      if (!win.isDestroyed()) win.close()
    }
    this.entries.clear()
  }

  private redraw(entry: Entry): void {
    if (entry.win.isDestroyed()) return
    const arr = JSON.stringify(Array.from(entry.active))
    entry.win.webContents
      .executeJavaScript(`window.drawGrid && window.drawGrid(${entry.cols},${entry.rows},${arr})`)
      .catch(() => { /* window may have been destroyed */ })
  }
}
