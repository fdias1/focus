export type AppState = 'off' | 'active' | 'monitoring' | 'alarm'

export interface AppConfig {
  inactivityThreshold: number // seconds, default 30
  snapshotInterval: number    // seconds, default 5
  changeSensitivity: number   // percentage 0.01–1, default 0.1
  alarmInterval: number       // seconds, default 60
}

export const IPC = {
  GET_STATE: 'focus:get-state',
  STATE_CHANGED: 'focus:state-changed',
  TOGGLE: 'focus:toggle',
  GET_CONFIG: 'focus:get-config',
  SET_CONFIG: 'focus:set-config'
} as const
