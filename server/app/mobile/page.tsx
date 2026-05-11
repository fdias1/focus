'use client'

import jsQR from 'jsqr'
import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Pairing {
  id: string
  desktopId: string
  nickname: string | null
  createdAt: string
}

type Screen = 'home' | 'scan' | 'confirm' | 'token'

interface QRPayload {
  v: number
  token: string
  server: string
}

interface StoredNotification {
  id: string
  desktopId: string
  title: string
  body: string
  receivedAt: number
}

const NOTIF_KEY = 'focus_notifications'
const NOTIF_MAX = 100

function loadNotifications(): StoredNotification[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveNotifications(list: StoredNotification[]): void {
  localStorage.setItem(NOTIF_KEY, JSON.stringify(list.slice(0, NOTIF_MAX)))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientId(): string {
  let id = localStorage.getItem('focus_client_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('focus_client_id', id)
  }
  return id
}

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MobilePage() {
  const [clientId, setClientId] = useState('')
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [screen, setScreen] = useState<Screen>('home')
  const [pendingToken, setPendingToken] = useState('')
  const [nickname, setNickname] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [status, setStatus] = useState('')
  const [notifState, setNotifState] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown')
  const [subscribed, setSubscribed] = useState(false)
  const [pushError, setPushError] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [notifications, setNotifications] = useState<StoredNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [cameraError, setCameraError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const scannedRef = useRef(false)

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  useEffect(() => {
    const id = getClientId()
    setClientId(id)

    // Load persisted notifications
    setNotifications(loadNotifications())

    // Register SW and listen for messages from it
    const swContainer = 'serviceWorker' in navigator
      ? (navigator as Navigator & { serviceWorker: ServiceWorkerContainer }).serviceWorker
      : null

    let cleanup: (() => void) | undefined

    if (swContainer) {
      swContainer.register('/sw.js').catch(console.error)

      const onMessage = (event: MessageEvent) => {
        const msg = event.data as { type: string; notification?: StoredNotification; desktopId?: string }
        if (msg.type === 'alert' && msg.notification) {
          setNotifications((prev) => {
            if (prev.some((n) => n.id === msg.notification!.id)) return prev
            const next = [msg.notification!, ...prev].slice(0, NOTIF_MAX)
            saveNotifications(next)
            return next
          })
        } else if (msg.type === 'clear') {
          setNotifications((prev) => {
            const next = msg.desktopId ? prev.filter((n) => n.desktopId !== msg.desktopId) : []
            saveNotifications(next)
            return next
          })
        }
      }
      swContainer.addEventListener('message', onMessage)
      cleanup = () => swContainer.removeEventListener('message', onMessage)
    }

    // Check push support
    if (!('PushManager' in window)) {
      setNotifState('unsupported')
    } else {
      const perm = Notification.permission
      setNotifState(perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'unknown')
    }

    fetch(`/api/client/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: id })
    })
      .then(() => fetchPairings(id))
      .finally(() => setLoading(false))

    // Check if already subscribed and re-sync with server on every load.
    // This handles browser-side key rotation and re-installation on home screen.
    if (swContainer && 'PushManager' in window) {
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription()
        setSubscribed(!!sub)
        if (sub) {
          fetch('/api/web-push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: id, subscription: sub.toJSON() })
          }).catch(() => {})
        }
      })
    }

    return cleanup
  }, [])

  const fetchPairings = useCallback(async (id?: string) => {
    const cid = id ?? clientId
    if (!cid) return
    const res = await fetch(`/api/pairings/client/${cid}`, {
      headers: { 'x-client-id': cid }
    })
    if (res.ok) setPairings(await res.json())
  }, [clientId])

  // -------------------------------------------------------------------------
  // Push notification subscription
  // -------------------------------------------------------------------------

  async function subscribePush() {
    setPushError('')
    setSubscribing(true)
    try {
      // Step 1: ask for permission explicitly.
      // Safari requires this call before pushManager.subscribe().
      // Must originate from a user gesture — this is called from onClick, so it's valid.
      const permission = await Notification.requestPermission()
      if (permission === 'denied') {
        setNotifState('denied')
        return
      }
      if (permission !== 'granted') {
        // User dismissed the prompt without choosing — don't mark as denied.
        return
      }
      setNotifState('granted')

      // Step 2: fetch VAPID public key from server.
      const keyRes = await fetch('/api/web-push/vapid-key')
      if (!keyRes.ok) {
        setPushError('Server error fetching VAPID key. Make sure VAPID_PUBLIC_KEY is set in Vercel env vars.')
        return
      }
      const { publicKey } = await keyRes.json() as { publicKey?: string }
      if (!publicKey) {
        setPushError('Push notifications are not configured on the server (missing VAPID key).')
        return
      }

      // Step 3: subscribe via Service Worker.
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer
      })

      // Step 4: save subscription on server.
      const saveRes = await fetch('/api/web-push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, subscription: sub.toJSON() })
      })
      if (!saveRes.ok) {
        setPushError('Subscribed locally but failed to save to server. Try again.')
        return
      }

      setSubscribed(true)
    } catch (e) {
      // Only reaches here for unexpected errors (e.g. SW not supported, browser bug).
      // Do NOT set notifState to 'denied' — permission wasn't denied.
      const msg = e instanceof Error ? e.message : String(e)
      setPushError(`Subscription failed: ${msg}`)
      console.error('subscribePush error:', e)
    } finally {
      setSubscribing(false)
    }
  }

  async function unsubscribePush() {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    await fetch('/api/web-push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, endpoint })
    })
    setSubscribed(false)
  }

  // -------------------------------------------------------------------------
  // QR scanner
  // -------------------------------------------------------------------------

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    scannedRef.current = false
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError('')
    scannedRef.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()

      const tick = () => {
        if (scannedRef.current) return
        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d')!
        if (video.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0)
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(imgData.data, imgData.width, imgData.height)
          if (code) {
            scannedRef.current = true
            stopCamera()
            handleQRData(code.data)
            return
          }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      setCameraError('Camera not available. Use manual token entry below.')
    }
  }, [stopCamera])

  useEffect(() => {
    if (screen === 'scan') startCamera()
    else stopCamera()
    return stopCamera
  }, [screen, startCamera, stopCamera])

  function handleQRData(raw: string) {
    try {
      const payload = JSON.parse(raw) as QRPayload
      if (payload.v === 1 && payload.token) {
        setPendingToken(payload.token)
        setNickname('')
        setScreen('confirm')
        return
      }
    } catch {}
    setStatus('Invalid QR code.')
    setScreen('home')
  }

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  async function confirmPairing(token: string) {
    setStatus('Pairing…')
    try {
      const res = await fetch('/api/pairing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim().toUpperCase(),
          clientId,
          nickname: nickname.trim() || undefined
        })
      })
      if (res.ok) {
        setStatus('Paired successfully!')
        setPendingToken('')
        setManualToken('')
        setNickname('')
        setScreen('home')
        fetchPairings()
      } else {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        setStatus(`Error: ${error}`)
        setScreen('home')
      }
    } catch {
      setStatus('Network error — try again.')
      setScreen('home')
    }
  }

  async function removePairing(pairingId: string) {
    if (!confirm('Remove this desktop?')) return
    await fetch(`/api/pairing/${pairingId}`, {
      method: 'DELETE',
      headers: { 'x-client-id': clientId }
    })
    fetchPairings()
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) return <Centered><Spinner /></Centered>

  // Confirm screen (after QR scan)
  if (screen === 'confirm') {
    return (
      <Page>
        <Header title="Confirm Pairing" onBack={() => setScreen('home')} />
        <Card>
          <p style={s.label}>Token</p>
          <p style={{ ...s.token }}>{pendingToken}</p>
          <Input
            placeholder="Nickname (optional)"
            value={nickname}
            onChange={setNickname}
          />
          <Btn onClick={() => confirmPairing(pendingToken)}>Confirm</Btn>
          <BtnGhost onClick={() => setScreen('home')}>Cancel</BtnGhost>
        </Card>
      </Page>
    )
  }

  // Manual token entry
  if (screen === 'token') {
    return (
      <Page>
        <Header title="Enter Token" onBack={() => setScreen('home')} />
        <Card>
          <p style={s.hint}>Type the 6-character code shown in Focus Desktop.</p>
          <Input
            placeholder="e.g. AB3X9Z"
            value={manualToken}
            onChange={(v) => setManualToken(v.toUpperCase())}
            maxLength={6}
            autoFocus
          />
          <Input
            placeholder="Nickname (optional)"
            value={nickname}
            onChange={setNickname}
          />
          <Btn
            onClick={() => confirmPairing(manualToken)}
            disabled={manualToken.length < 6}
          >
            Confirm
          </Btn>
          <BtnGhost onClick={() => setScreen('home')}>Cancel</BtnGhost>
        </Card>
      </Page>
    )
  }

  // Scanner screen
  if (screen === 'scan') {
    return (
      <Page>
        <Header title="Scan QR Code" onBack={() => { stopCamera(); setScreen('home') }} />
        <div style={s.scanWrapper}>
          <video ref={videoRef} style={s.video} playsInline muted />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div style={s.scanOverlay}>
            <div style={s.scanFrame} />
          </div>
          {cameraError && <p style={s.errorText}>{cameraError}</p>}
        </div>
        {cameraError && (
          <div style={{ padding: '0 24px' }}>
            <Btn onClick={() => setScreen('token')}>Enter Token Manually</Btn>
          </div>
        )}
      </Page>
    )
  }

  // Home screen
  return (
    <Page>
      <div style={s.hero}>
        <div style={s.heroIcon}>⊙</div>
        <h1 style={s.heroTitle}>Focus</h1>
        <p style={s.heroSub}>Screen activity alerts on your phone.</p>
      </div>

      {/* Notification banner */}
      <NotifBanner
        state={notifState}
        subscribed={subscribed}
        subscribing={subscribing}
        pushError={pushError}
        onSubscribe={subscribePush}
        onUnsubscribe={unsubscribePush}
      />

      {/* Recent alerts */}
      {notifications.length > 0 && (
        <section style={s.section}>
          <Row>
            <p style={s.sectionTitle}>Recent Alerts</p>
            <button style={s.refreshBtn} onClick={() => {
              saveNotifications([])
              setNotifications([])
            }}>✕ Clear</button>
          </Row>
          {notifications.map((n) => (
            <div key={n.id} style={s.alertRow}>
              <div style={s.alertDot} />
              <div style={{ flex: 1 }}>
                <p style={s.alertBody}>{n.body}</p>
                <p style={s.alertMeta}>{new Date(n.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Paired desktops */}
      <section style={s.section}>
        <Row>
          <p style={s.sectionTitle}>Paired Desktops</p>
          <button style={s.refreshBtn} onClick={() => fetchPairings()}>↻</button>
        </Row>

        {pairings.length === 0 ? (
          <p style={s.empty}>No paired desktops yet.</p>
        ) : (
          pairings.map((p) => (
            <div key={p.id} style={s.pairingRow}>
              <div>
                <p style={s.pairingName}>{p.nickname ?? `Desktop ${p.desktopId.slice(0, 8)}`}</p>
                <p style={s.pairingMeta}>Since {new Date(p.createdAt).toLocaleDateString()}</p>
              </div>
              <button style={s.removeBtn} onClick={() => removePairing(p.id)}>Remove</button>
            </div>
          ))
        )}
      </section>

      {/* Add pairing */}
      <section style={s.section}>
        <p style={s.sectionTitle}>Add Desktop</p>
        <Btn onClick={() => setScreen('scan')}>📷  Scan QR Code</Btn>
        <BtnGhost onClick={() => { setManualToken(''); setNickname(''); setScreen('token') }}>
          Enter Token Manually
        </BtnGhost>
      </section>

      {status && <p style={s.statusMsg}>{status}</p>}

      <p style={s.clientId}>
        ID: {clientId.slice(0, 8)} · v{process.env.NEXT_PUBLIC_APP_VERSION} ({process.env.NEXT_PUBLIC_GIT_SHA})
      </p>
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Page({ children }: { children: React.ReactNode }) {
  return <div style={s.page}>{children}</div>
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={s.centered}>{children}</div>
}

function Spinner() {
  return <div style={s.spinner} />
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={s.header}>
      <button style={s.backBtn} onClick={onBack}>←</button>
      <p style={s.headerTitle}>{title}</p>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={s.row}>{children}</div>
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={s.card}>{children}</div>
}

function Input({
  placeholder, value, onChange, maxLength, autoFocus
}: {
  placeholder?: string
  value: string
  onChange: (v: string) => void
  maxLength?: number
  autoFocus?: boolean
}) {
  return (
    <input
      style={s.input}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      autoFocus={autoFocus}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  )
}

function Btn({
  children, onClick, disabled
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button style={{ ...s.btn, opacity: disabled ? 0.4 : 1 }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button style={s.btnGhost} onClick={onClick}>{children}</button>
}

function NotifBanner({
  state, subscribed, subscribing, pushError, onSubscribe, onUnsubscribe
}: {
  state: 'unknown' | 'granted' | 'denied' | 'unsupported'
  subscribed: boolean
  subscribing: boolean
  pushError: string
  onSubscribe: () => void
  onUnsubscribe: () => void
}) {
  if (state === 'unsupported') {
    return (
      <div style={{ ...s.banner, ...s.bannerWarn }}>
        <p style={s.bannerText}>
          Push notifications require adding this page to your Home Screen (iOS) or using Chrome/Edge on Android.
        </p>
      </div>
    )
  }
  if (state === 'denied') {
    return (
      <div style={{ ...s.banner, ...s.bannerWarn }}>
        <p style={s.bannerText}>
          Notifications are blocked. Go to browser Settings → Site Settings → Notifications and allow this site.
        </p>
      </div>
    )
  }
  if (state === 'granted' && subscribed) {
    return (
      <div style={{ ...s.banner, ...s.bannerOk }}>
        <p style={s.bannerText}>🔔 Notifications enabled</p>
        <button style={s.bannerBtn} onClick={onUnsubscribe}>Disable</button>
      </div>
    )
  }
  return (
    <>
      <div style={{ ...s.banner, ...s.bannerIdle }}>
        <p style={s.bannerText}>Enable push notifications to receive alerts.</p>
        <button style={{ ...s.bannerBtn, opacity: subscribing ? 0.5 : 1 }} onClick={onSubscribe} disabled={subscribing}>
          {subscribing ? '…' : 'Enable'}
        </button>
      </div>
      {pushError && (
        <div style={{ ...s.banner, ...s.bannerWarn, marginTop: 8 }}>
          <p style={{ ...s.bannerText, fontSize: 12 }}>⚠ {pushError}</p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const C = {
  bg: '#111827',
  surface: '#1f2937',
  border: '#374151',
  text: '#f9fafb',
  muted: '#9ca3af',
  accent: '#3b82f6',
  danger: '#ef4444',
  ok: '#22c55e',
  warn: '#f59e0b'
}

const s: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    background: C.bg,
    minHeight: '100dvh',
    color: C.text,
    paddingBottom: 48
  },
  centered: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100dvh', background: C.bg
  },
  spinner: {
    width: 32, height: 32,
    border: `3px solid ${C.border}`,
    borderTop: `3px solid ${C.accent}`,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  hero: {
    padding: '48px 24px 24px',
    textAlign: 'center' as const
  },
  heroIcon: { fontSize: 40, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 },
  heroSub: { fontSize: 14, color: C.muted, margin: '8px 0 0' },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '16px 20px',
    borderBottom: `1px solid ${C.border}`
  },
  backBtn: {
    background: 'none', border: 'none', color: C.accent,
    fontSize: 20, cursor: 'pointer', padding: '4px 8px'
  },
  headerTitle: { fontSize: 17, fontWeight: 600, margin: 0 },
  section: { padding: '24px 24px 0' },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: 0.5, margin: '0 0 12px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  refreshBtn: { background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer' },
  pairingRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 0', borderBottom: `1px solid ${C.border}`
  },
  pairingName: { fontSize: 15, fontWeight: 600, margin: 0 },
  pairingMeta: { fontSize: 12, color: C.muted, margin: '2px 0 0' },
  removeBtn: {
    background: 'rgba(239,68,68,0.12)', color: C.danger,
    border: 'none', borderRadius: 8, padding: '6px 12px',
    fontSize: 13, cursor: 'pointer'
  },
  alertRow: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    padding: '12px 0', borderBottom: `1px solid ${C.border}`
  },
  alertDot: {
    width: 8, height: 8, borderRadius: '50%',
    background: C.danger, flexShrink: 0, marginTop: 5
  },
  alertBody: { fontSize: 14, margin: 0, color: C.text },
  alertMeta: { fontSize: 12, color: C.muted, margin: '3px 0 0' },
  empty: { color: C.muted, fontSize: 14, margin: '4px 0 0' },
  card: {
    background: C.surface, borderRadius: 16,
    padding: 20, margin: '16px 24px 0'
  },
  label: { fontSize: 13, color: C.muted, margin: '0 0 4px' },
  token: { fontSize: 28, fontWeight: 700, letterSpacing: 6, margin: '0 0 16px', fontVariantNumeric: 'tabular-nums' },
  hint: { fontSize: 14, color: C.muted, margin: '0 0 16px' },
  input: {
    display: 'block', width: '100%', boxSizing: 'border-box' as const,
    padding: '12px 14px', marginBottom: 12,
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
    color: C.text, fontSize: 16, outline: 'none'
  },
  btn: {
    display: 'block', width: '100%', padding: '14px',
    background: C.accent, color: '#fff', border: 'none',
    borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer',
    marginBottom: 10
  },
  btnGhost: {
    display: 'block', width: '100%', padding: '14px',
    background: C.surface, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 12, fontSize: 15, cursor: 'pointer',
    marginBottom: 10
  },
  scanWrapper: { position: 'relative' as const, overflow: 'hidden', background: '#000' },
  video: { display: 'block', width: '100%', maxHeight: '70dvh', objectFit: 'cover' as const },
  scanOverlay: {
    position: 'absolute' as const, inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.35)'
  },
  scanFrame: {
    width: 220, height: 220,
    border: `3px solid ${C.accent}`,
    borderRadius: 20,
    boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`
  },
  errorText: { color: C.warn, textAlign: 'center' as const, padding: 16, fontSize: 14 },
  banner: {
    margin: '20px 24px 0',
    padding: '14px 16px',
    borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
  },
  bannerOk: { background: 'rgba(34,197,94,0.15)', border: `1px solid rgba(34,197,94,0.3)` },
  bannerWarn: { background: 'rgba(245,158,11,0.12)', border: `1px solid rgba(245,158,11,0.3)` },
  bannerIdle: { background: C.surface, border: `1px solid ${C.border}` },
  bannerText: { fontSize: 13, margin: 0, color: C.text, flex: 1 },
  bannerBtn: {
    background: C.accent, color: '#fff', border: 'none',
    borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' as const
  },
  statusMsg: { textAlign: 'center' as const, fontSize: 14, color: C.muted, padding: '16px 24px 0' },
  clientId: { textAlign: 'center' as const, fontSize: 11, color: C.border, padding: '24px 0 0', fontFamily: 'monospace' }
}
