export type AppState = 'off' | 'active' | 'monitoring' | 'alarm'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface AppConfig {
  inactivityThreshold: number  // seconds, default 30
  snapshotInterval: number     // seconds, default 5
  changeSensitivity: number    // percentage 0.01–1, default 0.1
  alarmInterval: number        // seconds, default 60
  watchArea: Region | null     // null = monitor full screen
  localNotifications: boolean  // OS sound alarm, default true
  remoteNotifications: boolean // push to paired mobiles, default false
}

export const IPC = {
  GET_STATE: 'focus:get-state',
  STATE_CHANGED: 'focus:state-changed',
  TOGGLE: 'focus:toggle',
  GET_CONFIG: 'focus:get-config',
  SET_CONFIG: 'focus:set-config',
  START_AREA_SELECTION: 'focus:start-area-selection',
  PAIR_DEVICE: 'focus:pair-device',
  GET_DESKTOP_ID: 'focus:get-desktop-id'
} as const

export interface PairResult {
  ok: boolean
  error?: string
}
