export type AppState = 'off' | 'active' | 'pending-monitor' | 'monitoring' | 'alarm'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface WatchArea {
  displayId: number  // matches Electron Display.id
  x: number          // physical pixels within the display's captured frame
  y: number
  width: number
  height: number
}

export interface AppConfig {
  inactivityThreshold: number  // seconds, default 30
  snapshotInterval: number     // seconds, default 5
  changeSensitivity: number    // percentage 0.1–100, default 10
  alarmInterval: number        // seconds, default 60
  watchAreas: WatchArea[]      // empty = monitor all displays at full
  localNotifications: boolean  // OS sound alarm, default true
  remoteNotifications: boolean // push to paired mobiles, default false
  telegramScreenshots: boolean // attach a screenshot to Telegram alerts, default false
  airplaneMode: boolean        // disables remote command poller, default false
}

export const IPC = {
  GET_STATE: 'focus:get-state',
  STATE_CHANGED: 'focus:state-changed',
  TOGGLE: 'focus:toggle',
  FORCE_MONITORING: 'focus:force-monitoring',
  GET_CONFIG: 'focus:get-config',
  SET_CONFIG: 'focus:set-config',
  START_AREA_SELECTION: 'focus:start-area-selection',
  PAIR_DEVICE: 'focus:pair-device',
  GET_DESKTOP_ID: 'focus:get-desktop-id',
  GET_SCREEN_PERMISSION: 'focus:get-screen-permission',
  OPEN_SCREEN_SETTINGS: 'focus:open-screen-settings',
  SCREEN_PERMISSION_DENIED: 'focus:screen-permission-denied',
  GET_DISPLAYS: 'focus:get-displays'
} as const

export interface PairResult {
  ok: boolean
  error?: string
}
