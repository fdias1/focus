import { EventEmitter } from 'events'
import { execSync } from 'child_process'

// Returns seconds since last input (mouse, keyboard, trackpad) using OS APIs.
// macOS: ioreg HIDIdleTime (no permissions required).
// Windows: GetLastInputInfo via PowerShell (no permissions required).
// Returns null when the platform is unsupported or the command fails.
function getSystemIdleSeconds(): number | null {
  try {
    if (process.platform === 'darwin') {
      const raw = execSync(
        "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF/1000000000; exit}'",
        { timeout: 1000 }
      )
        .toString()
        .trim()
      const val = parseFloat(raw)
      return isNaN(val) ? null : val
    }

    if (process.platform === 'win32') {
      const script = [
        'Add-Type @"',
        'using System; using System.Runtime.InteropServices;',
        'public class InputIdle {',
        '  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);',
        '  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }',
        '  public static double IdleSeconds() {',
        '    var i = new LASTINPUTINFO(); i.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(i);',
        '    GetLastInputInfo(ref i);',
        '    return (Environment.TickCount - (int)i.dwTime) / 1000.0;',
        '  }',
        '}',
        '"@',
        '[InputIdle]::IdleSeconds()'
      ].join('\n')
      const raw = execSync(`powershell -NoProfile -Command "${script}"`, { timeout: 3000 })
        .toString()
        .trim()
      const val = parseFloat(raw)
      return isNaN(val) ? null : val
    }
  } catch {
    // Command failed — fall back to mouse-only detection
  }
  return null
}

export class InactivityDetector extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private lastPos = { x: -1, y: -1 }
  private lastMoveAt = Date.now()
  private inactive = false
  private readonly pollMs = 500

  start(thresholdSeconds: number): void {
    this.stop()
    this.lastMoveAt = Date.now()
    this.inactive = false

    this.timer = setInterval(() => {
      const idleSeconds = getSystemIdleSeconds()

      if (idleSeconds !== null) {
        // OS-level idle time covers mouse, keyboard and trackpad.
        const isIdle = idleSeconds >= thresholdSeconds
        if (!isIdle && this.inactive) {
          this.inactive = false
          this.emit('active')
        } else if (isIdle && !this.inactive) {
          this.inactive = true
          this.emit('inactive')
        }
      } else {
        // Fallback: mouse-position polling only.
        const { screen } = require('electron') as typeof import('electron')
        const pos = screen.getCursorScreenPoint()
        const moved = pos.x !== this.lastPos.x || pos.y !== this.lastPos.y

        if (moved) {
          this.lastPos = pos
          this.lastMoveAt = Date.now()
          if (this.inactive) {
            this.inactive = false
            this.emit('active')
          }
        } else if (!this.inactive && Date.now() - this.lastMoveAt >= thresholdSeconds * 1000) {
          this.inactive = true
          this.emit('inactive')
        }
      }
    }, this.pollMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.inactive) {
      this.inactive = false
      this.emit('active')
    }
  }
}
