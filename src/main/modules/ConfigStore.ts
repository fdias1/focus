import Store from 'electron-store'
import { AppConfig } from '../../shared/ipc-types'

const DEFAULTS: AppConfig = {
  inactivityThreshold: 30,
  snapshotInterval: 5,
  changeSensitivity: 10,
  alarmInterval: 60
}

const BOUNDS: Record<keyof AppConfig, [number, number]> = {
  inactivityThreshold: [5, 3600],
  snapshotInterval: [1, 60],
  changeSensitivity: [1, 100],
  alarmInterval: [10, 3600]
}

export class ConfigStore {
  private store: Store<AppConfig>

  constructor() {
    this.store = new Store<AppConfig>({ defaults: DEFAULTS })
  }

  get(): AppConfig {
    return {
      inactivityThreshold: this.clamp('inactivityThreshold', this.store.get('inactivityThreshold')),
      snapshotInterval: this.clamp('snapshotInterval', this.store.get('snapshotInterval')),
      changeSensitivity: this.clamp('changeSensitivity', this.store.get('changeSensitivity')),
      alarmInterval: this.clamp('alarmInterval', this.store.get('alarmInterval'))
    }
  }

  set(partial: Partial<AppConfig>): void {
    for (const key of Object.keys(partial) as Array<keyof AppConfig>) {
      const value = partial[key]
      if (value !== undefined) {
        this.store.set(key, this.clamp(key, value))
      }
    }
  }

  private clamp(key: keyof AppConfig, value: number): number {
    const [min, max] = BOUNDS[key]
    return Math.min(max, Math.max(min, value))
  }
}
