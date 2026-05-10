import { app, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { ConfigStore } from './modules/ConfigStore'
import { StateManager } from './modules/StateManager'
import { TrayManager } from './modules/TrayManager'
import { IPC, AppConfig } from '../shared/ipc-types'

// Start as a background/accessory app — no dock icon, no cmd+tab entry.
// setActivationPolicy is macOS-only; on other platforms this is a no-op.
if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory')
}

let configWindow: BrowserWindow | null = null

function createConfigWindow(): void {
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular')
  }

  configWindow = new BrowserWindow({
    width: 400,
    height: 480,
    resizable: false,
    title: 'Focus — Settings',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    },
    icon: nativeImage.createEmpty()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    configWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    configWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  configWindow.on('closed', () => {
    configWindow = null
    if (process.platform === 'darwin') {
      app.setActivationPolicy('accessory')
    }
  })
}

app.whenReady().then(() => {
  const config = new ConfigStore()
  const state = new StateManager(config)
  const tray = new TrayManager(state, () => {
    if (configWindow) {
      configWindow.focus()
    } else {
      createConfigWindow()
    }
  })

  ipcMain.handle(IPC.GET_STATE, () => state.current)
  ipcMain.handle(IPC.TOGGLE, () => state.toggle())
  ipcMain.handle(IPC.GET_CONFIG, () => config.get())
  ipcMain.handle(IPC.SET_CONFIG, (_event, partial: Partial<AppConfig>) => {
    config.set(partial)
  })

  state.on('stateChanged', (newState) => {
    tray.update(newState)
    configWindow?.webContents.send(IPC.STATE_CHANGED, newState)
  })

  app.on('window-all-closed', () => { /* keep running as tray app */ })
  app.on('before-quit', () => {
    state.stop()
    tray.destroy()
  })
})
