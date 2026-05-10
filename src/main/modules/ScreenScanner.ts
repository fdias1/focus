import { EventEmitter } from 'events'
import { desktopCapturer, screen } from 'electron'

export interface Frame {
  data: Buffer
  width: number
  height: number
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
    try {
      const display = screen.getPrimaryDisplay()
      const { width, height } = display.bounds

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      })

      const primary = sources[0]
      if (!primary) return

      const image = primary.thumbnail
      const frame: Frame = {
        data: image.getBitmap(),
        width: image.getSize().width,
        height: image.getSize().height
      }
      this.emit('frame', frame)
    } catch {
      // Capture can fail if permission is revoked; silently skip
    }
  }
}
