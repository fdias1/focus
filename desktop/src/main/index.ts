import { app, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { ConfigStore } from './modules/ConfigStore'
import { StateManager } from './modules/StateManager'
import { TrayManager } from './modules/TrayManager'
import { selectArea } from './modules/AreaSelector'
import { ensureDesktopRegistered } from './modules/DesktopRegistrar'
import { openQRWindow } from './modules/QRWindow'
import { requestScreenPermission, getScreenPermissionStatus } from './modules/ScreenScanner'
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
    height: 650,
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

app.whenReady().then(async () => {
  const config = new ConfigStore()

  // Register with the Focus server in the background; never blocks startup.
  ensureDesktopRegistered(config)

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
    state.applyConfig(partial)
  })
  ipcMain.handle(IPC.START_AREA_SELECTION, async () => {
    configWindow?.hide()
    const region = await selectArea()
    configWindow?.show()
    config.set({ watchArea: region })
    return region
  })
  ipcMain.handle(IPC.GET_DESKTOP_ID, () => config.getServerCredentials().desktopId)
  ipcMain.handle(IPC.PAIR_DEVICE, async () => openQRWindow(config))
  ipcMain.handle(IPC.GET_SCREEN_PERMISSION, () => getScreenPermissionStatus())
  ipcMain.handle(IPC.OPEN_SCREEN_SETTINGS, () => requestScreenPermission())

  state.on('stateChanged', (newState) => {
    tray.update(newState)
    configWindow?.webContents.send(IPC.STATE_CHANGED, newState)
  })
  state.on('screenPermissionDenied', () => {
    configWindow?.webContents.send(IPC.SCREEN_PERMISSION_DENIED)
  })

  // Toggle after listeners are wired so the initial 'active' state propagates to the tray.
  state.toggle()

  app.on('window-all-closed', () => { /* keep running as tray app */ })
  app.on('before-quit', () => {
    state.stop()
    tray.destroy()
  })
})
