import { powerSaveBlocker } from 'electron'

export class WakeLockManager {
  private displayId: number | null = null
  private suspendId: number | null = null

  start(): void {
    if (this.displayId !== null) return
    this.displayId = powerSaveBlocker.start('prevent-display-sleep')
    this.suspendId = powerSaveBlocker.start('prevent-app-suspension')
  }

  stop(): void {
    if (this.displayId !== null) {
      powerSaveBlocker.stop(this.displayId)
      this.displayId = null
    }
    if (this.suspendId !== null) {
      powerSaveBlocker.stop(this.suspendId)
      this.suspendId = null
    }
  }

  get active(): boolean {
    return this.displayId !== null
  }
}
