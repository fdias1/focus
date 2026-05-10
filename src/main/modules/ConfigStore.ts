import Store from 'electron-store'
import { AppConfig, Region } from '../../shared/ipc-types'

type NumericKey = Exclude<keyof AppConfig, 'watchArea'>

const NUMERIC_DEFAULTS: Record<NumericKey, number> = {
  inactivityThreshold: 30,
  snapshotInterval: 5,
  changeSensitivity: 0.1,
  alarmInterval: 60
}

const BOUNDS: Record<NumericKey, [number, number]> = {
  inactivityThreshold: [5, 3600],
  snapshotInterval: [1, 60],
  changeSensitivity: [0.01, 1],
  alarmInterval: [10, 3600]
}

const NUMERIC_KEYS = Object.keys(NUMERIC_DEFAULTS) as NumericKey[]

type StoreSchema = Record<NumericKey, number> & { watchArea: Region | null }

export class ConfigStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: { ...NUMERIC_DEFAULTS, watchArea: null }
    })
  }

  get(): AppConfig {
    return {
      inactivityThreshold: this.clamp('inactivityThreshold', this.store.get('inactivityThreshold') as number),
      snapshotInterval: this.clamp('snapshotInterval', this.store.get('snapshotInterval') as number),
      changeSensitivity: this.clamp('changeSensitivity', this.store.get('changeSensitivity') as number),
      alarmInterval: this.clamp('alarmInterval', this.store.get('alarmInterval') as number),
      watchArea: (this.store.get('watchArea') as Region | null) ?? null
    }
  }

  set(partial: Partial<AppConfig>): void {
    for (const key of NUMERIC_KEYS) {
      if (key in partial) {
        const value = partial[key] as number
        this.store.set(key, this.clamp(key, value))
      }
    }
    if ('watchArea' in partial) {
      this.store.set('watchArea', partial.watchArea ?? null)
    }
  }

  private clamp(key: NumericKey, value: number): number {
    const [min, max] = BOUNDS[key]
    return Math.min(max, Math.max(min, value))
  }
}
