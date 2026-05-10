import { EventEmitter } from 'events'
import { AppState } from '../../shared/ipc-types'
import { ConfigStore } from './ConfigStore'
import { WakeLockManager } from './WakeLockManager'
import { InactivityDetector } from './InactivityDetector'
import { ScreenScanner, Frame } from './ScreenScanner'
import { hasSignificantChange, getTrayExclusionRegion } from './ChangeDetector'
import { AlarmManager } from './AlarmManager'
import { OverlayManager } from './OverlayManager'

export class StateManager extends EventEmitter {
  private _current: AppState = 'off'
  private prevFrame: Frame | null = null

  private readonly wake = new WakeLockManager()
  private readonly inactivity = new InactivityDetector()
  private readonly scanner = new ScreenScanner()
  private readonly alarm = new AlarmManager()
  private readonly overlay = new OverlayManager()

  constructor(private readonly config: ConfigStore) {
    super()
    this.inactivity.on('inactive', () => this.onInactive())
    this.inactivity.on('active', () => this.onActive())
    this.scanner.on('frame', (frame: Frame) => this.onFrame(frame))
  }

  get current(): AppState {
    return this._current
  }

  toggle(): void {
    if (this._current === 'off') {
      this.transition('active')
      const cfg = this.config.get()
      this.wake.start()
      this.inactivity.start(cfg.inactivityThreshold)
    } else {
      this.stop()
    }
  }

  stop(): void {
    this.wake.stop()
    this.inactivity.stop()
    this.scanner.stop()
    this.alarm.reset()
    this.overlay.hideAll()
    this.prevFrame = null
    this.transition('off')
  }

  private onInactive(): void {
    if (this._current !== 'active') return
    const cfg = this.config.get()
    this.prevFrame = null
    this.scanner.start(cfg.snapshotInterval)
    this.transition('monitoring')
  }

  private onActive(): void {
    if (this._current === 'off') return
    this.scanner.stop()
    this.alarm.reset()
    this.overlay.hideAll()
    this.prevFrame = null
    this.transition('active')
  }

  private onFrame(frame: Frame): void {
    if (this._current !== 'monitoring' && this._current !== 'alarm') return

    // Always hide overlays before comparing so previous boxes don't
    // accumulate into the next bounding box calculation.
    this.overlay.hideAll()

    if (this.prevFrame) {
      const cfg = this.config.get()
      const result = hasSignificantChange(
        this.prevFrame.data,
        frame.data,
        frame.width,
        frame.height,
        cfg.changeSensitivity,
        getTrayExclusionRegion()
      )

      if (result.changed) {
        if (result.bbox) this.overlay.showAll([result.bbox])
        if (this._current !== 'alarm') {
          this.alarm.trigger(cfg.alarmInterval)
          this.transition('alarm')
        }
      }
    }

    this.prevFrame = frame
  }

  private transition(next: AppState): void {
    if (this._current === next) return
    this._current = next
    this.emit('stateChanged', next)
  }
}
