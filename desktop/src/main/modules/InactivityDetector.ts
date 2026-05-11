import { EventEmitter } from 'events'
import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process'

// Returns seconds since last input. Non-blocking: spawns the OS query and
// resolves when the result is back. Resolves to null on unsupported platform
// or command failure (caller falls back to mouse polling).

function ioregIdleSeconds(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF/1000000000; exit}'"],
      { timeout: 1000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const v = parseFloat(stdout.trim())
        resolve(isNaN(v) ? null : v)
      }
    )
  })
}

// Persistent PowerShell session: Add-Type compiles once, then we just call
// IdleSeconds() on every poll. Avoids 500ms+ of JIT per poll.
const POWERSHELL_BOOT = [
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
  '"@'
].join('\n')

class WindowsIdleQuery {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending: ((v: number | null) => void) | null = null
  private buffer = ''

  query(): Promise<number | null> {
    return new Promise((resolve) => {
      if (this.pending) return resolve(null) // previous still in-flight; skip
      try {
        if (!this.proc || this.proc.exitCode !== null) this.boot()
      } catch {
        return resolve(null)
      }
      if (!this.proc) return resolve(null)
      this.pending = resolve
      this.proc.stdin.write('[InputIdle]::IdleSeconds()\n')
    })
  }

  stop(): void {
    if (this.proc) {
      try { this.proc.kill() } catch { /* ignore */ }
      this.proc = null
    }
    this.pending = null
    this.buffer = ''
  }

  private boot(): void {
    this.buffer = ''
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', '-'])
    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      const nl = this.buffer.indexOf('\n')
      if (nl < 0 || !this.pending) return
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      const v = parseFloat(line)
      const resolve = this.pending
      this.pending = null
      resolve(isNaN(v) ? null : v)
    })
    this.proc.on('exit', () => {
      const resolve = this.pending
      this.pending = null
      if (resolve) resolve(null)
    })
    this.proc.stdin.write(`${POWERSHELL_BOOT}\n`)
  }
}

export class InactivityDetector extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private lastPos = { x: -1, y: -1 }
  private lastMoveAt = Date.now()
  private inactive = false
  private readonly pollMs = 1000
  private readonly winQuery = process.platform === 'win32' ? new WindowsIdleQuery() : null
  private polling = false

  start(thresholdSeconds: number): void {
    this.stop()
    this.lastMoveAt = Date.now()
    this.inactive = false
    this.timer = setInterval(() => this.poll(thresholdSeconds), this.pollMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.winQuery?.stop()
    if (this.inactive) {
      this.inactive = false
      this.emit('active')
    }
  }

  private async poll(thresholdSeconds: number): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      let idleSeconds: number | null = null
      if (process.platform === 'darwin') {
        idleSeconds = await ioregIdleSeconds()
      } else if (process.platform === 'win32' && this.winQuery) {
        idleSeconds = await this.winQuery.query()
      }

      if (idleSeconds !== null) {
        const isIdle = idleSeconds >= thresholdSeconds
        if (!isIdle && this.inactive) {
          this.inactive = false
          this.emit('active')
        } else if (isIdle && !this.inactive) {
          this.inactive = true
          this.emit('inactive')
        }
        return
      }

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
    } finally {
      this.polling = false
    }
  }
}
