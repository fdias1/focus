import { EventEmitter } from 'events'
import { desktopCapturer, screen, systemPreferences, shell, Display } from 'electron'

export interface Frame {
  data: Buffer
  width: number      // physical pixels
  height: number
  display: Display   // the Electron Display this frame belongs to
}

export function getScreenPermissionStatus(): 'granted' | 'denied' | 'not-determined' {
  if (process.platform !== 'darwin') return 'granted'
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return 'granted'
  if (status === 'denied' || status === 'restricted') return 'denied'
  return 'not-determined'
}

export async function requestScreenPermission(): Promise<'granted' | 'denied' | 'not-determined'> {
  if (process.platform !== 'darwin') return 'granted'
  const status = getScreenPermissionStatus()
  if (status === 'granted') return 'granted'
  if (status === 'denied') {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
    return 'denied'
  }
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
    if (process.platform === 'darwin' && getScreenPermissionStatus() !== 'granted') {
      this.emit('permissionDenied')
      return
    }

    try {
      const displays = screen.getAllDisplays()

      // Request at the largest display's physical resolution — each source
      // will be scaled to its natural size within this maximum.
      const maxW = Math.max(...displays.map((d) => d.bounds.width * d.scaleFactor))
      const maxH = Math.max(...displays.map((d) => d.bounds.height * d.scaleFactor))

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: maxW, height: maxH }
      })

      if (sources.length === 0) {
        this.emit('permissionDenied')
        return
      }

      for (const display of displays) {
        // Match source to display: Electron sets display_id on macOS/Windows.
        const source =
          sources.find((s) => s.display_id === String(display.id)) ??
          sources[displays.indexOf(display)] // fallback: positional match

        if (!source) continue

        const image = source.thumbnail
        const { width, height } = image.getSize()
        if (width === 0 || height === 0) continue

        const frame: Frame = {
          data: image.getBitmap(),
          width,
          height,
          display
        }
        this.emit('frame', frame)
      }
    } catch (e) {
      this.emit('permissionDenied')
    }
  }
}
