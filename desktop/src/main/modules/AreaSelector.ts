import { BrowserWindow, ipcMain, screen, Display } from 'electron'
import { join } from 'path'
import { WatchArea } from '../../shared/ipc-types'

const RESULT_CHANNEL = 'focus:area-selection-result'

// Builds the selector HTML for a specific display, embedding its id and scaleFactor
// so the selection result can be converted to physical pixel coordinates.
function makeSelectorHtml(displayId: number, scaleFactor: number, displayIndex: number, totalDisplays: number): string {
  const label = totalDisplays > 1 ? `Display ${displayIndex + 1} — Click and drag to select watch area` : 'Click and drag to select watch area'
  return encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: rgba(0,0,0,0.45);
    overflow: hidden;
    cursor: crosshair;
    user-select: none;
  }
  #hint {
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%,-50%);
    color: rgba(255,255,255,0.9);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px; font-weight: 500;
    text-align: center;
    text-shadow: 0 1px 3px rgba(0,0,0,0.7);
    pointer-events: none;
  }
  #hint kbd {
    background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: inherit;
  }
  #selection {
    position: fixed; border: 2px solid #3b82f6;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.3);
    pointer-events: none; display: none;
  }
  #dims {
    position: fixed; color: #fff; background: rgba(0,0,0,0.65);
    font-family: -apple-system, sans-serif; font-size: 11px; font-weight: 500;
    padding: 2px 7px; border-radius: 4px;
    pointer-events: none; display: none; white-space: nowrap;
  }
</style>
</head>
<body>
  <div id="hint">${label}<br><kbd>ESC</kbd> to cancel</div>
  <div id="selection"></div>
  <div id="dims"></div>
  <script>
    var DISPLAY_ID = ${displayId};
    var SCALE_FACTOR = ${scaleFactor};
    var startX, startY, dragging = false;
    var sel = document.getElementById('selection');
    var hint = document.getElementById('hint');
    var dims = document.getElementById('dims');

    document.addEventListener('mousedown', function(e) {
      startX = e.clientX; startY = e.clientY; dragging = true;
      hint.style.display = 'none'; sel.style.display = 'block'; dims.style.display = 'block';
      update(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function(e) { if (dragging) update(e.clientX, e.clientY); });
    document.addEventListener('mouseup', function(e) {
      if (!dragging) return; dragging = false;
      var x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
      var w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
      if (w < 10 || h < 10) { window.selectorApp.sendResult(null); return; }
      window.selectorApp.sendResult({
        displayId: DISPLAY_ID,
        x: Math.round(x * SCALE_FACTOR),
        y: Math.round(y * SCALE_FACTOR),
        width: Math.round(w * SCALE_FACTOR),
        height: Math.round(h * SCALE_FACTOR)
      });
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') window.selectorApp.sendResult(null);
    });
    function update(cx, cy) {
      var x = Math.min(startX, cx), y = Math.min(startY, cy);
      var w = Math.abs(cx - startX), h = Math.abs(cy - startY);
      sel.style.left = x+'px'; sel.style.top = y+'px';
      sel.style.width = w+'px'; sel.style.height = h+'px';
      dims.textContent = Math.round(w * SCALE_FACTOR) + ' × ' + Math.round(h * SCALE_FACTOR) + ' px';
      var lx = x+w+8, ly = y+h-20;
      if (lx+100 > window.innerWidth) lx = x-108;
      if (ly+20 > window.innerHeight) ly = y+h-24;
      dims.style.left = lx+'px'; dims.style.top = ly+'px';
    }
  </script>
</body>
</html>`)
}

function createSelectorWindow(display: Display, displayIndex: number, totalDisplays: number): BrowserWindow {
  const { x, y, width, height } = display.bounds
  const html = makeSelectorHtml(display.id, display.scaleFactor, displayIndex, totalDisplays)

  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true, frame: false,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false,
    focusable: true, hasShadow: false, roundedCorners: false,
    webPreferences: {
      preload: join(__dirname, '../preload/selector.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadURL(`data:text/html;charset=utf-8,${html}`)
  return win
}

export function selectArea(): Promise<WatchArea | null> {
  return new Promise((resolve) => {
    const displays = screen.getAllDisplays()
    const windows: BrowserWindow[] = []
    let resolved = false

    function done(result: WatchArea | null): void {
      if (resolved) return
      resolved = true
      ipcMain.removeListener(RESULT_CHANNEL, onResult)
      windows.forEach((w) => { if (!w.isDestroyed()) w.close() })
      resolve(result)
    }

    function onResult(
      _event: Electron.IpcMainEvent,
      raw: { displayId: number; x: number; y: number; width: number; height: number } | null
    ): void {
      done(raw ?? null)
    }

    ipcMain.on(RESULT_CHANNEL, onResult)

    for (let i = 0; i < displays.length; i++) {
      const win = createSelectorWindow(displays[i], i, displays.length)
      // Focus the primary display's window.
      if (displays[i].id === screen.getPrimaryDisplay().id) win.focus()
      win.on('closed', () => {
        const allClosed = windows.every((w) => w.isDestroyed())
        if (allClosed) done(null)
      })
      windows.push(win)
    }
  })
}

export { RESULT_CHANNEL as AREA_SELECTION_RESULT_CHANNEL }
