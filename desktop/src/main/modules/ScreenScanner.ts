import { EventEmitter } from 'events'
import { desktopCapturer, screen, systemPreferences, shell } from 'electron'

export interface Frame {
  data: Buffer
  width: number
  height: number
}

/** Returns the current macOS Screen Recording permission status, or 'granted' on other platforms. */
export function getScreenPermissionStatus(): 'granted' | 'denied' | 'not-determined' {
  if (process.platform !== 'darwin') return 'granted'
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return 'granted'
  if (status === 'denied' || status === 'restricted') return 'denied'
  return 'not-determined' // 'unknown' or 'not-determined'
}

/**
 * Triggers the macOS Screen Recording permission prompt if not yet determined.
 * No-op on Windows/Linux. Opens System Settings if previously denied.
 */
export async function requestScreenPermission(): Promise<'granted' | 'denied' | 'not-determined'> {
  if (process.platform !== 'darwin') return 'granted'

  const status = getScreenPermissionStatus()

  if (status === 'granted') return 'granted'

  if (status === 'denied') {
    // macOS doesn't allow re-prompting — send user to System Settings.
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
    return 'denied'
  }

  // 'not-determined': calling getSources() triggers the OS permission dialog.
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
  } catch { /* ignore */ }

  return getScreenPermissionStatus()
}

export class ScreenScanner extends EventEmitter {
  private timer: NodeJS.Timeout | null = null

  start(intervalSeconds: number): void {
    this.stop()
    this.capture()
    this.timer = setInterval(() => this.capture(), intervalSeconds * 1000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async capture(): Promise<void> {
    // Check permission before every capture attempt on macOS.
    if (process.platform === 'darwin') {
      const status = getScreenPermissionStatus()
      if (status !== 'granted') {
        this.emit('permissionDenied', status)
        return
      }
    }

    try {
      const display = screen.getPrimaryDisplay()
      const { width, height } = display.bounds

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      })

      const primary = sources[0]
      if (!primary) {
        // Likely permission was just revoked.
        this.emit('permissionDenied', 'denied')
        return
      }

      const image = primary.thumbnail
      const frame: Frame = {
        data: image.getBitmap(),
        width: image.getSize().width,
        height: image.getSize().height
      }
      this.emit('frame', frame)
    } catch (e) {
      // Capture can fail if permission is revoked mid-session; emit event.
      this.emit('permissionDenied', 'denied')
    }
  }
}
