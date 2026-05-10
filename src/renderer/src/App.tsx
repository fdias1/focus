import { useEffect, useState } from 'react'
import { AppConfig, AppState } from '../../shared/ipc-types'

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
    alarmInterval: 60
  })

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
          min={1}
          max={100}
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
      </div>
    </div>
  )
}

function Setting({
  label,
  value,
  min,
  max,
  unit,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
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
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={styles.slider}
        />
        <span style={styles.value}>
          {value} {unit}
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
  }
}
