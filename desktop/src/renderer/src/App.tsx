import { useEffect, useState } from 'react'
import { AppConfig, AppState, PairResult, WatchArea } from '../../shared/ipc-types'

const STATE_LABEL: Record<AppState, string> = {
  off: 'Off',
  active: 'Active',
  'pending-monitor': 'Starting…',
  monitoring: 'Monitoring',
  alarm: 'Alarm'
}

const STATE_COLOR: Record<AppState, string> = {
  off: '#6b7280',
  active: '#22c55e',
  'pending-monitor': '#facc15',
  monitoring: '#3b82f6',
  alarm: '#ef4444'
}

interface DisplayInfo {
  id: number
  index: number
  primary: boolean
}

declare global {
  interface Window {
    focusApp: {
      getState: () => Promise<AppState>
      toggle: () => Promise<void>
      forceMonitoring: () => Promise<void>
      getConfig: () => Promise<AppConfig>
      setConfig: (partial: Partial<AppConfig>) => Promise<void>
      startAreaSelection: () => Promise<WatchArea | null>
      getDisplays: () => Promise<DisplayInfo[]>
      getDesktopId: () => Promise<string | null>
      pairDevice: () => Promise<PairResult>
      getScreenPermission: () => Promise<'granted' | 'denied' | 'not-determined'>
      openScreenSettings: () => Promise<void>
      onScreenPermissionDenied: (cb: () => void) => () => void
      onStateChanged: (cb: (state: AppState) => void) => () => void
    }
  }
}

export default function App() {
  const [state, setState] = useState<AppState>('off')
  const [config, setConfig] = useState<AppConfig>({
    inactivityThreshold: 30,
    snapshotInterval: 5,
    changeSensitivity: 10,
    alarmInterval: 60,
    watchAreas: [],
    localNotifications: true,
    remoteNotifications: false,
    telegramScreenshots: false,
    airplaneMode: false
  })
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selecting, setSelecting] = useState(false)
  const [desktopId, setDesktopId] = useState<string | null>(null)
  const [pairError, setPairError] = useState('')
  const [pairing, setPairing] = useState(false)
  const [screenPermission, setScreenPermission] = useState<'granted' | 'denied' | 'not-determined' | null>(null)

  useEffect(() => {
    window.focusApp.getState().then(setState)
    window.focusApp.getConfig().then(setConfig)
    window.focusApp.getDisplays().then(setDisplays)
    window.focusApp.getDesktopId().then(setDesktopId)
    window.focusApp.getScreenPermission().then(setScreenPermission)
    const unsubState = window.focusApp.onStateChanged(setState)
    const unsubPerm = window.focusApp.onScreenPermissionDenied(() => setScreenPermission('denied'))
    return () => {
      unsubState()
      unsubPerm()
    }
  }, [])

  function updateConfig(partial: Partial<AppConfig>) {
    const next = { ...config, ...partial }
    setConfig(next)
    window.focusApp.setConfig(partial)
  }

  function displayLabel(d: DisplayInfo): string {
    const name = displays.length > 1 ? `Display ${d.index + 1}` : 'Display'
    return d.primary ? `${name} (primary)` : name
  }

  function displayLabelById(displayId: number): string {
    const d = displays.find((x) => x.id === displayId)
    if (!d) return `Display ${displayId}`
    return displayLabel(d)
  }

  async function handleAddWatchArea() {
    setSelecting(true)
    const area = await window.focusApp.startAreaSelection()
    setSelecting(false)
    if (area) {
      // main process already saved; sync local state
      const existing = config.watchAreas.filter((wa) => wa.displayId !== area.displayId)
      setConfig((prev) => ({ ...prev, watchAreas: [...existing, area] }))
    }
  }

  function handleRemoveWatchArea(displayId: number) {
    const next = config.watchAreas.filter((wa) => wa.displayId !== displayId)
    updateConfig({ watchAreas: next })
  }

  // Sorted by display index for stable list order
  const sortedAreas = [...config.watchAreas].sort((a, b) => {
    const ia = displays.find((d) => d.id === a.displayId)?.index ?? 99
    const ib = displays.find((d) => d.id === b.displayId)?.index ?? 99
    return ia - ib
  })

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Focus</h1>

      <div style={{ ...styles.badge, backgroundColor: STATE_COLOR[state] }}>
        {STATE_LABEL[state]}
      </div>

      <button style={styles.toggle} onClick={() => window.focusApp.toggle()}>
        {state === 'off' ? 'Turn On' : 'Turn Off'}
      </button>

      <button
        style={styles.toggle}
        onClick={() => window.focusApp.forceMonitoring()}
      >
        Start Monitoring Now
      </button>

      {screenPermission && screenPermission !== 'granted' && (
        <div style={styles.permissionBanner}>
          <span style={styles.permissionText}>
            {screenPermission === 'denied'
              ? '⚠ Screen Recording denied — go to System Settings → Privacy → Screen Recording and enable Focus.'
              : '⚠ Screen Recording permission required to detect changes.'}
          </span>
          <button
            style={styles.permissionBtn}
            onClick={() => window.focusApp.openScreenSettings().then(() =>
              window.focusApp.getScreenPermission().then(setScreenPermission)
            )}
          >
            {screenPermission === 'denied' ? 'Open Settings' : 'Allow'}
          </button>
        </div>
      )}

      <div style={styles.settings}>
        <Setting
          label="Inactivity threshold"
          value={config.inactivityThreshold}
          min={5}
          max={3600}
          unit="s"
          onChange={(v) => updateConfig({ inactivityThreshold: v })}
        />
        <Setting
          label="Snapshot interval"
          value={config.snapshotInterval}
          min={1}
          max={60}
          unit="s"
          onChange={(v) => updateConfig({ snapshotInterval: v })}
        />
        <Setting
          label="Change sensitivity"
          value={config.changeSensitivity}
          min={0.1}
          max={100}
          step={0.1}
          decimals={1}
          unit="%"
          onChange={(v) => updateConfig({ changeSensitivity: v })}
        />
        <Setting
          label="Alarm interval"
          value={config.alarmInterval}
          min={10}
          max={3600}
          unit="s"
          onChange={(v) => updateConfig({ alarmInterval: v })}
        />

        {/* Notifications */}
        <div style={styles.sectionHeader}>Notifications</div>

        <Toggle
          label="Local (OS sound)"
          checked={config.localNotifications}
          onChange={(v) => updateConfig({ localNotifications: v })}
        />

        <div style={styles.row}>
          <Toggle
            label="Remote (push to mobile)"
            checked={config.remoteNotifications}
            onChange={(v) => { updateConfig({ remoteNotifications: v }); setPairError('') }}
          />
          {config.remoteNotifications && (
            <button
              style={{ ...styles.editBtn, opacity: pairing ? 0.5 : 1 }}
              disabled={pairing}
              onClick={async () => {
                setPairError('')
                setPairing(true)
                const result = await window.focusApp.pairDevice()
                setPairing(false)
                if (!result.ok && result.error) setPairError(result.error)
              }}
            >
              {pairing ? 'Connecting…' : 'Pair Device'}
            </button>
          )}
        </div>
        {pairError && (
          <p style={styles.errorMsg}>{pairError}</p>
        )}

        {config.remoteNotifications && (
          <Toggle
            label="Send screenshots to Telegram"
            checked={config.telegramScreenshots}
            onChange={(v) => updateConfig({ telegramScreenshots: v })}
          />
        )}

        <Toggle
          label="Airplane mode (block remote commands)"
          checked={config.airplaneMode}
          onChange={(v) => updateConfig({ airplaneMode: v })}
        />

        {/* Watch areas */}
        <div style={styles.sectionHeader}>Monitoring</div>

        {sortedAreas.length > 0 && (
          <div style={styles.watchAreaList}>
            {sortedAreas.map((wa) => (
              <div key={wa.displayId} style={styles.watchAreaItem}>
                <div style={styles.watchAreaItemLeft}>
                  <span style={styles.watchAreaName}>{displayLabelById(wa.displayId)}</span>
                  <span style={styles.watchAreaDims}>
                    {wa.width} × {wa.height} px
                  </span>
                </div>
                <div style={styles.watchAreaItemRight}>
                  <button
                    style={styles.editBtn}
                    disabled={selecting}
                    onClick={handleAddWatchArea}
                  >
                    Edit
                  </button>
                  <button
                    style={{ ...styles.editBtn, ...styles.removeBtn }}
                    onClick={() => handleRemoveWatchArea(wa.displayId)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={styles.addAreaRow}>
          {selecting ? (
            <span style={styles.selectingHint}>Click and drag on any display…</span>
          ) : (
            <button style={styles.addAreaBtn} onClick={handleAddWatchArea}>
              + Add Watch Area
            </button>
          )}
          {sortedAreas.length === 0 && !selecting && (
            <span style={styles.watchAreaHint}>All displays monitored (no restriction)</span>
          )}
        </div>
      </div>

      {desktopId && (
        <p style={styles.deviceId}>Device ID: {desktopId.slice(0, 8).toUpperCase()}</p>
      )}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label style={styles.checkboxLabel}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={styles.checkbox}
      />
      <span style={styles.label}>{label}</span>
    </label>
  )
}

function Setting({
  label,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  unit,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  decimals?: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div style={styles.row}>
      <label style={styles.label}>{label}</label>
      <div style={styles.inputGroup}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={styles.slider}
        />
        <span style={styles.value}>
          {value.toFixed(decimals)} {unit}
        </span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '24px',
    maxWidth: '360px',
    margin: '0 auto',
    color: '#111827'
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    margin: '0 0 16px'
  },
  badge: {
    display: 'inline-block',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: '999px',
    marginBottom: '16px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  toggle: {
    display: 'block',
    width: '100%',
    padding: '10px',
    fontSize: '15px',
    fontWeight: 600,
    backgroundColor: '#111827',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    marginBottom: '24px'
  },
  settings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151'
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  slider: {
    flex: 1
  },
  value: {
    fontSize: '13px',
    color: '#6b7280',
    minWidth: '52px',
    textAlign: 'right'
  },
  sectionHeader: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginTop: '4px'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer'
  },
  checkbox: {
    width: '15px',
    height: '15px',
    cursor: 'pointer'
  },
  editBtn: {
    fontSize: '12px',
    fontWeight: 500,
    padding: '3px 10px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    color: '#374151',
    cursor: 'pointer'
  },
  removeBtn: {
    color: '#ef4444',
    borderColor: '#fca5a5',
    background: '#fff5f5'
  },
  selectingHint: {
    fontSize: '12px',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  watchAreaList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  watchAreaItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 10px',
    borderRadius: '7px',
    border: '1px solid #e5e7eb',
    background: '#f9fafb'
  },
  watchAreaItemLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  watchAreaItemRight: {
    display: 'flex',
    gap: '6px'
  },
  watchAreaName: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#374151'
  },
  watchAreaDims: {
    fontSize: '11px',
    color: '#9ca3af'
  },
  addAreaRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  addAreaBtn: {
    alignSelf: 'flex-start',
    fontSize: '12px',
    fontWeight: 600,
    padding: '5px 12px',
    borderRadius: '6px',
    border: '1px solid #3b82f6',
    background: '#eff6ff',
    color: '#2563eb',
    cursor: 'pointer'
  },
  watchAreaHint: {
    fontSize: '11px',
    color: '#9ca3af'
  },
  errorMsg: {
    fontSize: '12px',
    color: '#dc2626',
    margin: '-8px 0 0',
    lineHeight: '1.4'
  },
  deviceId: {
    marginTop: '20px',
    fontSize: '11px',
    color: '#d1d5db',
    textAlign: 'center',
    fontFamily: 'monospace',
    letterSpacing: '0.08em'
  },
  permissionBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#fef3c7',
    border: '1px solid #f59e0b',
    borderRadius: '8px',
    padding: '10px 12px',
    marginBottom: '16px'
  },
  permissionText: {
    flex: 1,
    fontSize: '12px',
    color: '#92400e',
    lineHeight: '1.4'
  },
  permissionBtn: {
    flexShrink: 0,
    fontSize: '12px',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid #d97706',
    background: '#f59e0b',
    color: '#fff',
    cursor: 'pointer'
  }
}
