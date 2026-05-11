import { exec } from 'child_process'

export interface Notifier {
  notify(): void
}

class OsNotifier implements Notifier {
  notify(): void {
    const onDone = (err: Error | null): void => {
      if (err) console.error('[AlarmManager] sound playback failed:', err.message)
    }
    if (process.platform === 'darwin') {
      exec('afplay /System/Library/Sounds/Ping.aiff', onDone)
    } else if (process.platform === 'win32') {
      exec(
        'powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\notify.wav").PlaySync()',
        onDone
      )
    }
  }
}

export class AlarmManager {
  private timer: NodeJS.Timeout | null = null
  private readonly osNotifier = new OsNotifier()
  private extraNotifiers: Notifier[] = []
  private localEnabled = true

  setLocalEnabled(enabled: boolean): void {
    this.localEnabled = enabled
  }

  addNotifier(notifier: Notifier): void {
    this.extraNotifiers.push(notifier)
  }

  removeNotifier(notifier: Notifier): void {
    this.extraNotifiers = this.extraNotifiers.filter((n) => n !== notifier)
  }

  trigger(intervalSeconds: number): void {
    if (this.timer) return
    this.fire()
    this.timer = setInterval(() => this.fire(), intervalSeconds * 1000)
  }

  reset(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private fire(): void {
    if (this.localEnabled) this.osNotifier.notify()
    for (const n of this.extraNotifiers) n.notify()
  }
}
