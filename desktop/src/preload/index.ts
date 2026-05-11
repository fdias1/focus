import { contextBridge, ipcRenderer } from 'electron'
import { IPC, AppConfig, AppState, PairResult, Region } from '../shared/ipc-types'

contextBridge.exposeInMainWorld('focusApp', {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.GET_STATE),
  toggle: (): Promise<void> => ipcRenderer.invoke(IPC.TOGGLE),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.GET_CONFIG),
  setConfig: (config: Partial<AppConfig>): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_CONFIG, config),
  startAreaSelection: (): Promise<Region | null> =>
    ipcRenderer.invoke(IPC.START_AREA_SELECTION),
  getDesktopId: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.GET_DESKTOP_ID),
  pairDevice: (): Promise<PairResult> =>
    ipcRenderer.invoke(IPC.PAIR_DEVICE),
  getScreenPermission: (): Promise<'granted' | 'denied' | 'not-determined'> =>
    ipcRenderer.invoke(IPC.GET_SCREEN_PERMISSION),
  openScreenSettings: (): Promise<void> =>
    ipcRenderer.invoke(IPC.OPEN_SCREEN_SETTINGS),
  onStateChanged: (cb: (state: AppState) => void) => {
    ipcRenderer.on(IPC.STATE_CHANGED, (_event, state) => cb(state))
    return () => ipcRenderer.removeAllListeners(IPC.STATE_CHANGED)
  },
  onScreenPermissionDenied: (cb: () => void) => {
    ipcRenderer.on(IPC.SCREEN_PERMISSION_DENIED, cb)
    return () => ipcRenderer.removeAllListeners(IPC.SCREEN_PERMISSION_DENIED)
  }
})
