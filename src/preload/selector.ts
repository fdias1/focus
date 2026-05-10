import { contextBridge, ipcRenderer } from 'electron'
import { Region } from '../shared/ipc-types'

// Minimal preload for the area-selector overlay window.
contextBridge.exposeInMainWorld('selectorApp', {
  sendResult: (region: Region | null) =>
    ipcRenderer.send('focus:area-selection-result', region)
})
