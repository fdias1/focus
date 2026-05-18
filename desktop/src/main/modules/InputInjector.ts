import { execFile } from 'child_process'
import { Display, systemPreferences } from 'electron'

export function checkAccessibilityPermission(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

export class InputInjector {
  async click(xFrac: number, yFrac: number, button: 'left' | 'right', display: Display): Promise<void> {
    if (!checkAccessibilityPermission()) { console.warn('[InputInjector] Accessibility permission not granted'); return }
    const x = display.bounds.x + Math.round(xFrac * display.bounds.width)
    const y = display.bounds.y + Math.round(yFrac * display.bounds.height)

    if (process.platform === 'darwin') {
      const action = button === 'right' ? 'right click' : 'click'
      await osascript(`tell application "System Events" to ${action} at {${x}, ${y}}`)
    } else if (process.platform === 'win32') {
      await powershell(winClickScript(x, y, button === 'right'))
    }
  }

  async typeText(text: string): Promise<void> {
    if (!checkAccessibilityPermission()) return
    if (!text) return

    if (process.platform === 'darwin') {
      // Escape special AppleScript characters inside the quoted string.
      const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      await osascript(`tell application "System Events" to keystroke "${safe}"`)
    } else if (process.platform === 'win32') {
      const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}')
      await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')`)
    }
  }

  async pressKey(key: string): Promise<void> {
    if (!checkAccessibilityPermission()) return

    if (process.platform === 'darwin') {
      const mapped = macKeyCode(key)
      if (mapped !== null) {
        await osascript(`tell application "System Events" to key code ${mapped}`)
      }
    } else if (process.platform === 'win32') {
      const mapped = winKey(key)
      if (mapped) {
        await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${mapped}')`)
      }
    }
  }
}

function osascript(script: string): Promise<void> {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (err) => {
      if (err) console.warn('[InputInjector] osascript error:', err.message)
      resolve()
    })
  })
}

function powershell(script: string): Promise<void> {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], (err) => {
      if (err) console.warn('[InputInjector] powershell error:', err.message)
      resolve()
    })
  })
}

function winClickScript(x: number, y: number, right: boolean): string {
  const down = right ? 8 : 2
  const up = right ? 16 : 4
  return `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int c,int e);
}
'@; [W32]::SetCursorPos(${x},${y}); [W32]::mouse_event(${down},${x},${y},0,0); [W32]::mouse_event(${up},${x},${y},0,0)`
}

function macKeyCode(key: string): number | null {
  const map: Record<string, number> = {
    Return: 36, Tab: 48, Space: 49, Backspace: 51, Escape: 53, Delete: 117,
    ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
    Home: 115, End: 119, PageUp: 116, PageDown: 121,
    F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97,
    F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
    ' ': 49
  }
  return map[key] ?? null
}

function winKey(key: string): string | null {
  const map: Record<string, string> = {
    Enter: '{ENTER}', Tab: '{TAB}', ' ': ' ', Backspace: '{BACKSPACE}',
    Delete: '{DELETE}', Escape: '{ESC}',
    ArrowLeft: '{LEFT}', ArrowRight: '{RIGHT}', ArrowUp: '{UP}', ArrowDown: '{DOWN}',
    Home: '{HOME}', End: '{END}', PageUp: '{PGUP}', PageDown: '{PGDN}',
    F1: '{F1}', F2: '{F2}', F3: '{F3}', F4: '{F4}', F5: '{F5}', F6: '{F6}',
    F7: '{F7}', F8: '{F8}', F9: '{F9}', F10: '{F10}', F11: '{F11}', F12: '{F12}'
  }
  return map[key] ?? null
}
