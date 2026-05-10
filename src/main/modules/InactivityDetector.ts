import { EventEmitter } from 'events'
import { screen } from 'electron'

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
