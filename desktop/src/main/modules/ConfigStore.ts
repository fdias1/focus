import Store from 'electron-store'
import { AppConfig, WatchArea } from '../../shared/ipc-types'

type NumericKey = 'inactivityThreshold' | 'snapshotInterval' | 'changeSensitivity' | 'alarmInterval'
type BooleanKey = 'localNotifications' | 'remoteNotifications'

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

const BOOLEAN_DEFAULTS: Record<BooleanKey, boolean> = {
  localNotifications: true,
  remoteNotifications: false
}

const NUMERIC_KEYS: NumericKey[] = [
  'inactivityThreshold',
  'snapshotInterval',
  'changeSensitivity',
  'alarmInterval'
]
const BOOLEAN_KEYS: BooleanKey[] = ['localNotifications', 'remoteNotifications']

interface StoreSchema extends Record<NumericKey, number>, Record<BooleanKey, boolean> {
  watchAreas: WatchArea[]
  // Server credentials — never exposed via IPC to the renderer.
  desktopId: string | null
  apiKey: string | null
}

export class ConfigStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: {
        ...NUMERIC_DEFAULTS,
        ...BOOLEAN_DEFAULTS,
        watchAreas: [],
        desktopId: null,
        apiKey: null
      }
    })
  }

  get(): AppConfig {
    return {
      inactivityThreshold: this.clamp('inactivityThreshold', this.store.get('inactivityThreshold')),
      snapshotInterval: this.clamp('snapshotInterval', this.store.get('snapshotInterval')),
      changeSensitivity: this.clamp('changeSensitivity', this.store.get('changeSensitivity')),
      alarmInterval: this.clamp('alarmInterval', this.store.get('alarmInterval')),
      watchAreas: (this.store.get('watchAreas') as WatchArea[]) ?? [],
      localNotifications: this.store.get('localNotifications'),
      remoteNotifications: this.store.get('remoteNotifications')
    }
  }

  set(partial: Partial<AppConfig>): void {
    for (const key of NUMERIC_KEYS) {
      if (key in partial) {
        this.store.set(key, this.clamp(key, partial[key] as number))
      }
    }
    for (const key of BOOLEAN_KEYS) {
      if (key in partial) {
        this.store.set(key, partial[key] as boolean)
      }
    }
    if ('watchAreas' in partial) {
      this.store.set('watchAreas', partial.watchAreas ?? [])
    }
  }

  // Server credentials — only accessible from the main process, never via IPC.
  getServerCredentials(): { desktopId: string | null; apiKey: string | null } {
    return {
      desktopId: (this.store.get('desktopId') as string | null) ?? null,
      apiKey: (this.store.get('apiKey') as string | null) ?? null
    }
  }

  setServerCredentials(desktopId: string, apiKey: string): void {
    this.store.set('desktopId', desktopId)
    this.store.set('apiKey', apiKey)
  }

  private clamp(key: NumericKey, value: number): number {
    const [min, max] = BOUNDS[key]
    return Math.min(max, Math.max(min, value))
  }
}
