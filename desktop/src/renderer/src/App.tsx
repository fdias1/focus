import { useEffect, useState } from 'react'
import { AppConfig, AppState, Region } from '../../shared/ipc-types'

const STATE_LABEL: Record<AppState, string> = {
  off: 'Off',
  active: 'Active',
  monitoring: 'Monitoring',
  alarm: 'Alarm'
}

const STATE_COLOR: Record<AppState, string> = {
  off: '#6b7280',
  active: '#22c55e',
  monitoring: '#3b82f6',
  alarm: '#ef4444'
}

declare global {
  interface Window {
    focusApp: {
      getState: () => Promise<AppState>
      toggle: () => Promise<void>
      getConfig: () => Promise<AppConfig>
      setConfig: (partial: Partial<AppConfig>) => Promise<void>
      startAreaSelection: () => Promise<Region | null>
      pairDevice: () => Promise<void>
      onStateChanged: (cb: (state: AppState) => void) => () => void
    }
  }
}

export default function App() {
  const [state, setState] = useState<AppState>('off')
  const [config, setConfig] = useState<AppConfig>({
    inactivityThreshold: 30,
    snapshotInterval: 5,
    changeSensitivity: 0.1,
    alarmInterval: 60,
    watchArea: null,
    localNotifications: true,
    remoteNotifications: false
  })
  const [selecting, setSelecting] = useState(false)

  useEffect(() => {
    window.focusApp.getState().then(setState)
    window.focusApp.getConfig().then(setConfig)
    return window.focusApp.onStateChanged(setState)
  }, [])

  function updateConfig(partial: Partial<AppConfig>) {
    const next = { ...config, ...partial }
    setConfig(next)
    window.focusApp.setConfig(partial)
  }

  async function handleWatchAreaToggle(checked: boolean) {
    if (!checked) {
      updateConfig({ watchArea: null })
      return
    }
    // Start selection; config window hides while user draws
    setSelecting(true)
    const region = await window.focusApp.startAreaSelection()
    setSelecting(false)
    if (region) {
      setConfig((prev) => ({ ...prev, watchArea: region }))
      // config is already saved in main; just sync local state
    }
  }

  async function handleEditWatchArea() {
    setSelecting(true)
    const region = await window.focusApp.startAreaSelection()
    setSelecting(false)
    if (region) {
      setConfig((prev) => ({ ...prev, watchArea: region }))
    }
  }

  const watchAreaSet = config.watchArea !== null

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Focus</h1>

      <div style={{ ...styles.badge, backgroundColor: STATE_COLOR[state] }}>
        {STATE_LABEL[state]}
      </div>

      <button style={styles.toggle} onClick={() => window.focusApp.toggle()}>
        {state === 'off' ? 'Turn On' : 'Turn Off'}
      </button>

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
          min={0.01}
          max={1}
          step={0.01}
          decimals={2}
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
            onChange={(v) => updateConfig({ remoteNotifications: v })}
          />
          {config.remoteNotifications && (
            <button style={styles.editBtn} onClick={() => window.focusApp.pairDevice()}>
              Pair Device
            </button>
          )}
        </div>

        {/* Watch area */}
        <div style={styles.sectionHeader}>Monitoring</div>
        <div style={styles.row}>
          <div style={styles.watchAreaRow}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={watchAreaSet}
                disabled={selecting}
                onChange={(e) => handleWatchAreaToggle(e.target.checked)}
                style={styles.checkbox}
              />
              <span style={styles.label}>Watch area</span>
            </label>
            {watchAreaSet && !selecting && (
              <button style={styles.editBtn} onClick={handleEditWatchArea}>
                Edit
              </button>
            )}
            {selecting && (
              <span style={styles.selectingHint}>selecting…</span>
            )}
          </div>
          {watchAreaSet && config.watchArea && (
            <span style={styles.watchAreaInfo}>
              {config.watchArea.width} × {config.watchArea.height} px at ({config.watchArea.x}, {config.watchArea.y})
            </span>
          )}
        </div>
      </div>
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
  watchAreaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
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
  selectingHint: {
    fontSize: '12px',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  watchAreaInfo: {
    fontSize: '11px',
    color: '#9ca3af',
    paddingLeft: '21px'
  }
}
