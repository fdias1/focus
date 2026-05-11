import { EventEmitter } from 'events'
import { AppConfig, AppState } from '../../shared/ipc-types'
import { ConfigStore } from './ConfigStore'
import { WakeLockManager } from './WakeLockManager'
import { InactivityDetector } from './InactivityDetector'
import { ScreenScanner, Frame, getScreenPermissionStatus } from './ScreenScanner'
import { hasSignificantChange, getTrayExclusionRegion } from './ChangeDetector'
import { AlarmManager } from './AlarmManager'
import { OverlayManager } from './OverlayManager'
import { RemoteNotifier } from './RemoteNotifier'

export { getScreenPermissionStatus }

export class StateManager extends EventEmitter {
  private _current: AppState = 'off'
  // One previous frame per display — keyed by Display.id
  private prevFrames = new Map<number, Frame>()

  private readonly wake = new WakeLockManager()
  private readonly inactivity = new InactivityDetector()
  private readonly scanner = new ScreenScanner()
  private readonly alarm = new AlarmManager()
  private readonly overlay = new OverlayManager()
  private readonly remote: RemoteNotifier

  constructor(private readonly config: ConfigStore) {
    super()
    this.remote = new RemoteNotifier(config)
    this.inactivity.on('inactive', () => this.onInactive())
    this.inactivity.on('active', () => this.onActive())
    this.scanner.on('frame', (frame: Frame) => this.onFrame(frame))
    this.scanner.on('permissionDenied', () => this.emit('screenPermissionDenied'))
  }

  get current(): AppState { return this._current }

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
    this.prevFrames.clear()
    this.transition('off')
  }

  /** Hot-applies time-sensitive config fields while running. */
  applyConfig(partial: Partial<AppConfig>): void {
    if (this._current === 'off') return
    if (partial.inactivityThreshold !== undefined) {
      this.inactivity.start(partial.inactivityThreshold)
    }
    if (partial.snapshotInterval !== undefined) {
      if (this._current === 'monitoring' || this._current === 'alarm') {
        this.scanner.start(partial.snapshotInterval)
      }
    }
    if (partial.alarmInterval !== undefined && this._current === 'alarm') {
      this.alarm.reset()
      this.alarm.trigger(partial.alarmInterval)
    }
  }

  private onInactive(): void {
    if (this._current !== 'active') return
    const cfg = this.config.get()
    this.prevFrames.clear()
    this.scanner.start(cfg.snapshotInterval)
    this.transition('monitoring')
  }

  private onActive(): void {
    if (this._current === 'off') return
    const wasAlarming = this._current === 'alarm'
    this.scanner.stop()
    this.alarm.reset()
    this.overlay.hideAll()
    this.prevFrames.clear()
    this.transition('active')
    if (wasAlarming && this.config.get().remoteNotifications) {
      this.remote.clear()
    }
  }

  private onFrame(frame: Frame): void {
    if (this._current !== 'monitoring' && this._current !== 'alarm') return

    const prev = this.prevFrames.get(frame.display.id)
    if (prev) {
      const cfg = this.config.get()
      this.alarm.setLocalEnabled(cfg.localNotifications)

      // Filter watch areas to those configured for this specific display.
      const displayWatchAreas = cfg.watchAreas
        .filter((wa) => wa.displayId === frame.display.id)
        .map(({ x, y, width, height }) => ({ x, y, width, height }))

      const result = hasSignificantChange(
        prev.data,
        frame.data,
        frame.width,
        frame.height,
        cfg.changeSensitivity,
        getTrayExclusionRegion(frame.display),
        displayWatchAreas
      )

      if (result.changed) {
        if (result.bbox) this.overlay.add(result.bbox, frame.display)

        if (this._current !== 'alarm') {
          // Only push on the first change that triggers the alarm;
          // additional overlays while already alarming don't re-notify.
          if (cfg.remoteNotifications) {
            this.remote.notify(crypto.randomUUID())
          }
          this.alarm.trigger(cfg.alarmInterval)
          this.transition('alarm')
        }
      }
    }

    this.prevFrames.set(frame.display.id, frame)
  }

  private transition(next: AppState): void {
    if (this._current === next) return
    this._current = next
    this.emit('stateChanged', next)
  }
}
