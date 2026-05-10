import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { Region } from '../../shared/ipc-types'

// Internal channel — only used between selector window and main.
const RESULT_CHANNEL = 'focus:area-selection-result'

const SELECTOR_HTML = encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.45);
    overflow: hidden;
    cursor: crosshair;
    user-select: none;
  }
  #hint {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: rgba(255, 255, 255, 0.85);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    pointer-events: none;
    text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  }
  #hint kbd {
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 12px;
    font-family: inherit;
  }
  #selection {
    position: fixed;
    border: 2px solid #3b82f6;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    display: none;
  }
  #dims {
    position: fixed;
    color: #fff;
    background: rgba(0, 0, 0, 0.65);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 4px;
    pointer-events: none;
    display: none;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <div id="hint">
    Click and drag to select watch area<br>
    <kbd>ESC</kbd> to cancel
  </div>
  <div id="selection"></div>
  <div id="dims"></div>
  <script>
    var startX, startY, dragging = false;
    var sel  = document.getElementById('selection');
    var hint = document.getElementById('hint');
    var dims = document.getElementById('dims');

    document.addEventListener('mousedown', function(e) {
      startX = e.clientX; startY = e.clientY;
      dragging = true;
      hint.style.display = 'none';
      sel.style.display = 'block';
      dims.style.display = 'block';
      update(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      update(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', function(e) {
      if (!dragging) return;
      dragging = false;
      var x = Math.min(startX, e.clientX);
      var y = Math.min(startY, e.clientY);
      var w = Math.abs(e.clientX - startX);
      var h = Math.abs(e.clientY - startY);
      if (w < 10 || h < 10) {
        window.selectorApp.sendResult(null);
        return;
      }
      window.selectorApp.sendResult({ x: x, y: y, width: w, height: h });
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') window.selectorApp.sendResult(null);
    });

    function update(cx, cy) {
      var x = Math.min(startX, cx);
      var y = Math.min(startY, cy);
      var w = Math.abs(cx - startX);
      var h = Math.abs(cy - startY);
      sel.style.left   = x + 'px';
      sel.style.top    = y + 'px';
      sel.style.width  = w + 'px';
      sel.style.height = h + 'px';
      dims.textContent = Math.round(w) + ' × ' + Math.round(h);
      // Position label below-right of the selection, clamped to viewport
      var lx = x + w + 8;
      var ly = y + h - 20;
      if (lx + 80 > window.innerWidth)  lx = x - 88;
      if (ly + 20 > window.innerHeight) ly = y + h - 24;
      dims.style.left = lx + 'px';
      dims.style.top  = ly + 'px';
    }
  </script>
</body>
</html>`)

export function selectArea(): Promise<Region | null> {
  return new Promise((resolve) => {
    const display = screen.getPrimaryDisplay()
    const { x, y, width, height } = display.bounds

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      hasShadow: false,
      roundedCorners: false,
      webPreferences: {
        preload: join(__dirname, '../preload/selector.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.loadURL(`data:text/html;charset=utf-8,${SELECTOR_HTML}`)
    win.focus()

    let resolved = false
    function done(region: Region | null): void {
      if (resolved) return
      resolved = true
      ipcMain.removeListener(RESULT_CHANNEL, onResult)
      if (!win.isDestroyed()) win.close()
      resolve(region)
    }

    function onResult(_event: Electron.IpcMainEvent, region: Region | null): void {
      done(region)
    }

    ipcMain.on(RESULT_CHANNEL, onResult)
    win.on('closed', () => done(null))
  })
}

export { RESULT_CHANNEL as AREA_SELECTION_RESULT_CHANNEL }
