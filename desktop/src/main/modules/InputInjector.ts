import { Display, systemPreferences } from 'electron'

// Lazy-load nut-js so that a missing native build does not crash the app at
// startup — we only actually call it when remoteControl is enabled.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nutMouse: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nutKeyboard: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nutButton: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nutKey: any = null

function loadNut(): boolean {
  if (nutMouse) return true
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nut = require('@nut-tree/nut-js')
    nutMouse = nut.mouse
    nutKeyboard = nut.keyboard
    nutButton = nut.Button
    nutKey = nut.Key
    return true
  } catch {
    return false
  }
}

export function checkAccessibilityPermission(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

export class InputInjector {
  async click(xFrac: number, yFrac: number, button: 'left' | 'right', display: Display): Promise<void> {
    if (!loadNut()) { console.warn('[InputInjector] nut-js not available'); return }
    if (!checkAccessibilityPermission()) { console.warn('[InputInjector] Accessibility permission not granted'); return }

    const x = display.bounds.x + Math.round(xFrac * display.bounds.width)
    const y = display.bounds.y + Math.round(yFrac * display.bounds.height)

    const btn = button === 'right' ? nutButton.RIGHT : nutButton.LEFT
    try {
      await nutMouse.setPosition({ x, y })
      await nutMouse.click(btn)
    } catch (e) {
      console.warn('[InputInjector] click failed:', e)
    }
  }

  async typeText(text: string): Promise<void> {
    if (!loadNut()) return
    if (!checkAccessibilityPermission()) return
    try {
      await nutKeyboard.type(text)
    } catch (e) {
      console.warn('[InputInjector] typeText failed:', e)
    }
  }

  async pressKey(key: string): Promise<void> {
    if (!loadNut()) return
    if (!checkAccessibilityPermission()) return

    const mapped = mapKey(key)
    if (!mapped) return
    try {
      await nutKeyboard.pressKey(mapped)
      await nutKeyboard.releaseKey(mapped)
    } catch (e) {
      console.warn('[InputInjector] pressKey failed:', e)
    }
  }
}

function mapKey(key: string): unknown {
  const k = nutKey
  if (!k) return null
  const map: Record<string, unknown> = {
    Enter: k.Return,
    Backspace: k.Backspace,
    Delete: k.Delete,
    Tab: k.Tab,
    Escape: k.Escape,
    ArrowLeft: k.Left,
    ArrowRight: k.Right,
    ArrowUp: k.Up,
    ArrowDown: k.Down,
    Home: k.Home,
    End: k.End,
    PageUp: k.PageUp,
    PageDown: k.PageDown,
    ' ': k.Space,
    F1: k.F1, F2: k.F2, F3: k.F3, F4: k.F4,
    F5: k.F5, F6: k.F6, F7: k.F7, F8: k.F8,
    F9: k.F9, F10: k.F10, F11: k.F11, F12: k.F12
  }
  return map[key] ?? null
}
