import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { AppState } from '../../shared/ipc-types'
import { StateManager } from './StateManager'

const ICON_MAP: Record<AppState, string> = {
  off: 'tray-off.png',
  active: 'tray-active.png',
  monitoring: 'tray-monitoring.png',
  alarm: 'tray-alarm.png'
}

export class TrayManager {
  private tray: Tray

  constructor(
    private readonly state: StateManager,
    private readonly openSettings: () => void
  ) {
    const icon = this.iconFor(state.current)
    this.tray = new Tray(icon)
    this.tray.setToolTip('Focus')
    this.buildMenu()
  }

  update(newState: AppState): void {
    this.tray.setImage(this.iconFor(newState))
    this.buildMenu()
  }

  destroy(): void {
    this.tray.destroy()
  }

  private buildMenu(): void {
    const isOn = this.state.current !== 'off'
    const menu = Menu.buildFromTemplate([
      {
        label: isOn ? 'Turn Off' : 'Turn On',
        click: () => this.state.toggle()
      },
      { label: 'Settings...', click: () => this.openSettings() },
      { type: 'separator' },
      { label: 'Quit Focus', role: 'quit' }
    ])
    this.tray.setContextMenu(menu)
  }

  private iconFor(state: AppState): Electron.NativeImage {
    try {
      return nativeImage.createFromPath(
        join(__dirname, '../../assets/icons', ICON_MAP[state])
      )
    } catch {
      return nativeImage.createEmpty()
    }
  }
}
