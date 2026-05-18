import { EventEmitter } from 'events'
import { screen } from 'electron'
import { AppConfig, AppState } from '../../shared/ipc-types'
import { ConfigStore } from './ConfigStore'
import { WakeLockManager } from './WakeLockManager'
import { InactivityDetector } from './InactivityDetector'
import { ScreenScanner, Frame, getScreenPermissionStatus } from './ScreenScanner'
import { hasSignificantChange, getTrayExclusionRegion } from './ChangeDetector'
import { AlarmManager } from './AlarmManager'
import { OverlayManager } from './OverlayManager'
import { RemoteNotifier } from './RemoteNotifier'
import { CommandPoller } from './CommandPoller'
import { RemoteControlManager } from './RemoteControlManager'
import { SERVER_URL } from './constants'

export { getScreenPermissionStatus }

export class StateManager extends EventEmitter {
  private _current: AppState = 'off'
  // One previous frame per display — keyed by Display.id
  private prevFrames = new Map<number, Frame>()
  // Per-display tracking for "new bounty box" notifications while in ALARM.
  // Stores the union of all chunk-masks already covered by a remote notification,
  // and the timestamp of the most recent remote notification on that display.
  private lastNotifiedActive = new Map<number, Uint8Array>()
  private lastRemoteNotifyAt = new Map<number, number>()

  private readonly wake = new WakeLockManager()
  private readonly inactivity = new InactivityDetector()
  private readonly scanner = new ScreenScanner()
  private readonly alarm = new AlarmManager()
  private readonly overlay = new OverlayManager()
  private readonly remote: RemoteNotifier
  private readonly poller: CommandPoller
  private readonly remoteControl: RemoteControlManager

  private pendingMonitorTimer: NodeJS.Timeout | null = null
  private pendingMonitorCommandIds: string[] = []

  constructor(private readonly config: ConfigStore) {
    super()
    this.remote = new RemoteNotifier(config)
    this.poller = new CommandPoller(config)
    this.remoteControl = new RemoteControlManager(config)
    this.inactivity.on('inactive', () => this.onInactive())
    this.inactivity.on('active', () => this.onActive())
    this.scanner.on('frame', (frame: Frame) => this.onFrame(frame))
    this.scanner.on('permissionDenied', () => this.emit('screenPermissionDenied'))
    this.poller.on('startMonitoring', (ids: string[]) => this.forceMonitoring(ids))
    this.poller.on('stopMonitoring', () => this.stop())

    // Poller runs at all times (incl. OFF) so remote /monitor and /release
    // can wake the app. Airplane mode is the user-controlled kill switch.
    if (!this.config.get().airplaneMode) this.poller.start()
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
    this.cancelPendingMonitor()
    this.wake.stop()
    this.inactivity.stop()
    this.scanner.stop()
    this.alarm.reset()
    this.overlay.hideAll()
    this.prevFrames.clear()
    this.lastNotifiedActive.clear()
    this.lastRemoteNotifyAt.clear()
    this.remoteControl.stopSession()
    this.transition('off')
  }

  /** Called on app quit — stop poller too. `stop()` keeps it alive on purpose. */
  shutdown(): void {
    this.poller.stop()
    this.stop()
  }

  /**
   * Enter the 5-second "pending-monitor" wait, then transition to MONITORING.
   * Works from any state, including OFF (wake lock is started on demand).
   * During the wait, inactivity events are ignored — the tray icon goes yellow
   * to signal "monitoring starts soon". When called for a remote command, the
   * supplied commandIds are acked back to the server once MONITORING begins,
   * so the Telegram handler can confirm to the user.
   */
  forceMonitoring(commandIds: string[] = []): void {
    // Already monitoring/alarming — nothing to start, but still ack so the
    // remote caller doesn't time out.
    if (this._current === 'monitoring' || this._current === 'alarm') {
      if (commandIds.length > 0) this.remote.ackMonitor(commandIds)
      return
    }
    // Coalesce repeated triggers during the wait window: accumulate command IDs
    // and let the existing timer run out.
    if (this._current === 'pending-monitor') {
      if (commandIds.length > 0) {
        this.pendingMonitorCommandIds.push(...commandIds)
      }
      return
    }

    if (this._current === 'off') {
      this.wake.start()
    }
    // Activity is ignored during the wait — user can move freely for 5s.
    this.inactivity.stop()
    this.pendingMonitorCommandIds = commandIds.slice()
    this.transition('pending-monitor')

    this.pendingMonitorTimer = setTimeout(() => {
      this.pendingMonitorTimer = null
      this.enterMonitoring()
    }, 5000)
  }

  toggleAirplaneMode(): void {
    const next = !this.config.get().airplaneMode
    this.config.set({ airplaneMode: next })
    this.applyConfig({ airplaneMode: next })
  }

  /** Hot-applies time-sensitive config fields while running. */
  applyConfig(partial: Partial<AppConfig>): void {
    if (partial.airplaneMode !== undefined) {
      if (partial.airplaneMode) this.poller.stop()
      else this.poller.start()
      this.emit('configChanged')
    }
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

  private enterMonitoring(): void {
    if (this._current !== 'pending-monitor') return
    const cfg = this.config.get()
    this.prevFrames.clear()
    this.scanner.start(cfg.snapshotInterval)
    this.inactivity.start(cfg.inactivityThreshold)
    this.inactivity.armForFreshInput()
    this.transition('monitoring')

    const ids = this.pendingMonitorCommandIds
    this.pendingMonitorCommandIds = []
    if (ids.length > 0) this.remote.ackMonitor(ids)
  }

  private cancelPendingMonitor(): void {
    if (this.pendingMonitorTimer) {
      clearTimeout(this.pendingMonitorTimer)
      this.pendingMonitorTimer = null
    }
    this.pendingMonitorCommandIds = []
  }

  private onInactive(): void {
    if (this._current !== 'active') return
    const cfg = this.config.get()
    this.prevFrames.clear()
    this.scanner.start(cfg.snapshotInterval)
    this.transition('monitoring')
  }

  private onActive(): void {
    if (this._current === 'off' || this._current === 'pending-monitor') return
    const wasAlarming = this._current === 'alarm'
    this.scanner.stop()
    this.alarm.reset()
    this.overlay.hideAll()
    this.prevFrames.clear()
    this.lastNotifiedActive.clear()
    this.lastRemoteNotifyAt.clear()
    this.transition('active')
    if (wasAlarming && this.config.get().remoteNotifications) {
      this.remote.clear()
    }
  }

  private onFrame(frame: Frame): void {
    if (this._current !== 'monitoring' && this._current !== 'alarm') return

    const prev = this.prevFrames.get(frame.display.id)
    if (prev && (prev.width !== frame.width || prev.height !== frame.height)) {
      // Resolution changed (rotation, DPI switch, monitor reconnect with same id).
      // Discard the stale prev and store this frame as the new baseline.
      this.prevFrames.set(frame.display.id, frame)
      return
    }
    if (prev) {
      const cfg = this.config.get()
      this.alarm.setLocalEnabled(cfg.localNotifications)

      // Filter watch areas to those configured for this specific display.
      const displayWatchAreas = cfg.watchAreas
        .filter((wa) => wa.displayId === frame.display.id)
        .map(({ x, y, width, height }) => ({ x, y, width, height }))

      // If watch areas are configured on ANY display, skip displays that have none —
      // the user explicitly limited monitoring to specific screens.
      if (cfg.watchAreas.length > 0 && displayWatchAreas.length === 0) return

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
        if (result.grid) this.overlay.update(result.grid, frame.display)

        if (this._current !== 'alarm') {
          // First change → trigger alarm and send the initial notification.
          if (cfg.remoteNotifications) {
            const png = cfg.telegramScreenshots ? frame.image.toPNG() : undefined
            if (cfg.remoteControl) {
              // Create a remote session asynchronously; include the link in the notify call.
              this.remoteControl.startSession(frame.display.id)
                .then((token) => {
                  const remoteLink = token ? `${SERVER_URL}/remote/${token}` : undefined
                  this.remote.notify(png, remoteLink)
                })
                .catch(() => this.remote.notify(png))
            } else {
              this.remote.notify(png)
            }
            if (result.grid) {
              this.lastNotifiedActive.set(frame.display.id, new Uint8Array(result.grid.active))
            }
            this.lastRemoteNotifyAt.set(frame.display.id, Date.now())
          }
          this.alarm.trigger(cfg.alarmInterval)
          this.transition('alarm')

          // Darken every display that isn't the one that triggered the alarm.
          // This ensures all screens are obscured even if they have no changes.
          for (const d of screen.getAllDisplays()) {
            if (d.id !== frame.display.id) this.overlay.darken(d)
          }
        } else if (
          cfg.remoteNotifications &&
          cfg.telegramScreenshots &&
          result.grid &&
          this.hasNewBountyBox(frame.display.id, result.grid.active) &&
          this.canNotifyRemote(frame.display.id, cfg.alarmInterval)
        ) {
          // Already in ALARM: only re-notify when a new region appeared AND we're
          // outside the alarm-interval window. Rate-limited to avoid spamming
          // Telegram on rapidly-changing screens.
          this.remote.notify(frame.image.toPNG())
          this.unionNotifiedActive(frame.display.id, result.grid.active)
          this.lastRemoteNotifyAt.set(frame.display.id, Date.now())
        }
      }
    }

    this.prevFrames.set(frame.display.id, frame)
  }

  private hasNewBountyBox(displayId: number, active: Uint8Array): boolean {
    const prev = this.lastNotifiedActive.get(displayId)
    if (!prev || prev.length !== active.length) return true
    for (let i = 0; i < active.length; i++) {
      if (active[i] && !prev[i]) return true
    }
    return false
  }

  private unionNotifiedActive(displayId: number, active: Uint8Array): void {
    const prev = this.lastNotifiedActive.get(displayId)
    if (!prev || prev.length !== active.length) {
      this.lastNotifiedActive.set(displayId, new Uint8Array(active))
      return
    }
    for (let i = 0; i < active.length; i++) {
      if (active[i]) prev[i] = 1
    }
  }

  private canNotifyRemote(displayId: number, alarmIntervalSec: number): boolean {
    const last = this.lastRemoteNotifyAt.get(displayId) ?? 0
    return Date.now() - last >= alarmIntervalSec * 1000
  }

  private transition(next: AppState): void {
    if (this._current === next) return
    this._current = next
    this.emit('stateChanged', next)
  }
}
