import { contextBridge, ipcRenderer } from 'electron'
import { IPC, AppConfig, AppState, Region } from '../shared/ipc-types'

contextBridge.exposeInMainWorld('focusApp', {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.GET_STATE),
  toggle: (): Promise<void> => ipcRenderer.invoke(IPC.TOGGLE),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.GET_CONFIG),
  setConfig: (config: Partial<AppConfig>): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_CONFIG, config),
  startAreaSelection: (): Promise<Region | null> =>
    ipcRenderer.invoke(IPC.START_AREA_SELECTION),
  onStateChanged: (cb: (state: AppState) => void) => {
    ipcRenderer.on(IPC.STATE_CHANGED, (_event, state) => cb(state))
    return () => ipcRenderer.removeAllListeners(IPC.STATE_CHANGED)
  }
})
