import { exec } from 'child_process'

export interface Notifier {
  notify(): void
}

class OsNotifier implements Notifier {
  notify(): void {
    if (process.platform === 'darwin') {
      exec('afplay /System/Library/Sounds/Ping.aiff')
    } else if (process.platform === 'win32') {
      exec(
        'powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\notify.wav").PlaySync()'
      )
    }
  }
}

export class AlarmManager {
  private timer: NodeJS.Timeout | null = null
  private notifiers: Notifier[] = [new OsNotifier()]

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

  addNotifier(notifier: Notifier): void {
    this.notifiers.push(notifier)
  }

  private fire(): void {
    for (const n of this.notifiers) n.notify()
  }
}
