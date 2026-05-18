'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]

const POLL_MS = 600

type Phase = 'loading' | 'waiting-offer' | 'connecting' | 'connected' | 'expired' | 'error'

interface SessionData {
  expired: boolean
  sessionId?: string
  displayId?: number
  desktopOffer?: string
  desktopIce?: RTCIceCandidateInit[]
}

export default function RemotePage() {
  const { token } = useParams<{ token: string }>()
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const sessionIdRef = useRef('')
  const desktopIceApplied = useRef(0)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null }
  }, [])

  const cleanupPeer = useCallback(() => {
    stopPolling()
    pcRef.current?.close()
    pcRef.current = null
    channelRef.current = null
    desktopIceApplied.current = 0
  }, [stopPolling])

  useEffect(() => cleanupPeer, [cleanupPeer])

  const pollDesktopIce = useCallback(async () => {
    const sessionId = sessionIdRef.current
    const pc = pcRef.current
    if (!sessionId || !pc) return
    try {
      const res = await fetch(`/api/remote/sessions/${sessionId}?token=${encodeURIComponent(token)}`)
      if (res.ok) {
        const data = await res.json() as { expired?: boolean; desktopIce?: RTCIceCandidateInit[] }
        if (data.expired) { cleanupPeer(); setPhase('expired'); return }
        const candidates = data.desktopIce ?? []
        for (let i = desktopIceApplied.current; i < candidates.length; i++) {
          await pc.addIceCandidate(new RTCIceCandidate(candidates[i])).catch(() => {})
          desktopIceApplied.current = i + 1
        }
      }
    } catch { /* network error, retry next tick */ }
    if (pc.connectionState !== 'connected') {
      pollTimer.current = setTimeout(pollDesktopIce, POLL_MS)
    }
  }, [token, cleanupPeer])

  const connect = useCallback(async () => {
    cleanupPeer()
    setPhase('loading')

    // Resolve token → sessionId + initial session state.
    const initData = await fetchJson<SessionData>(`/api/remote/sessions?token=${encodeURIComponent(token)}`)
    if (!initData) { setPhase('error'); setErrorMsg('Could not reach server.'); return }
    if (initData.expired || !initData.sessionId) { setPhase('expired'); return }

    const { sessionId } = initData
    sessionIdRef.current = sessionId

    // Wait for the desktop to post its offer (up to 60 s).
    let offer = initData.desktopOffer
    let desktopIce = initData.desktopIce ?? []

    if (!offer) {
      setPhase('waiting-offer')
      for (let i = 0; i < 60 && !offer; i++) {
        await delay(1000)
        const d = await fetchJson<SessionData>(`/api/remote/sessions/${sessionId}?token=${encodeURIComponent(token)}`)
        if (!d) continue
        if (d.expired) { setPhase('expired'); return }
        if (d.desktopOffer) { offer = d.desktopOffer; desktopIce = d.desktopIce ?? [] }
      }
    }

    if (!offer) { setPhase('error'); setErrorMsg('Desktop did not respond in time.'); return }
    setPhase('connecting')

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc

    pc.ontrack = (e) => {
      if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0]
    }

    pc.ondatachannel = (e) => { channelRef.current = e.channel }

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return
      fetch(`/api/remote/sessions/${sessionId}/mobile-signal?token=${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iceCandidate: JSON.stringify(candidate.toJSON()) })
      }).catch(() => {})
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { setPhase('connected'); stopPolling() }
      else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setPhase('error'); setErrorMsg('Connection lost.'); cleanupPeer()
      }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)))
    // Apply any desktop ICE already available.
    for (const c of desktopIce) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      desktopIceApplied.current++
    }

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await fetch(`/api/remote/sessions/${sessionId}/mobile-signal?token=${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: JSON.stringify(pc.localDescription) })
    }).catch(() => {})

    pollTimer.current = setTimeout(pollDesktopIce, POLL_MS)
  }, [token, cleanupPeer, stopPolling, pollDesktopIce])

  useEffect(() => { connect() }, [connect])

  // --- Input helpers ---

  function sendInput(msg: object) {
    const ch = channelRef.current
    if (ch?.readyState === 'open') ch.send(JSON.stringify(msg))
  }

  function handleVideoClick(e: React.MouseEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    sendInput({ type: 'click', xFrac: (e.clientX - rect.left) / rect.width, yFrac: (e.clientY - rect.top) / rect.height, button: 'left' })
  }

  function handlePointerDown(e: React.PointerEvent<HTMLVideoElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const xFrac = (e.clientX - rect.left) / rect.width
    const yFrac = (e.clientY - rect.top) / rect.height
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      sendInput({ type: 'click', xFrac, yFrac, button: 'right' })
    }, 500)
  }

  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    e.preventDefault()
    sendInput({ type: 'key', key: e.key })
  }

  function handleInput(e: React.FormEvent<HTMLInputElement>) {
    const inputEvent = e.nativeEvent as InputEvent
    if (inputEvent.data) sendInput({ type: 'type', text: inputEvent.data })
    ;(e.target as HTMLInputElement).value = ''
  }

  // --- Render ---

  if (phase === 'expired') {
    return (
      <Overlay>
        <Status icon="⏱" title="Session expired" sub="This link is no longer valid. Wait for the next alarm notification." />
      </Overlay>
    )
  }

  if (phase === 'error') {
    return (
      <Overlay>
        <Status icon="⚠" title="Connection failed" sub={errorMsg} />
        <button style={s.retryBtn} onClick={connect}>Retry</button>
      </Overlay>
    )
  }

  if (phase !== 'connected') {
    return (
      <Overlay>
        <div style={s.spinner} />
        <Status
          title={phase === 'waiting-offer' ? 'Waiting for desktop…' : 'Connecting…'}
          sub={phase === 'connecting' ? 'Establishing peer connection' : 'Fetching screen stream'}
        />
      </Overlay>
    )
  }

  return (
    <div style={s.root}>
      <input
        ref={inputRef}
        style={s.hiddenInput}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-hidden="true"
      />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={s.video}
        onClick={handleVideoClick}
        onPointerDown={handlePointerDown}
        onPointerUp={cancelLongPress}
        onPointerMove={cancelLongPress}
        onPointerLeave={cancelLongPress}
      />
      <button
        style={s.kbdBtn}
        onPointerDown={(e) => { e.stopPropagation(); inputRef.current?.focus() }}
        aria-label="Open keyboard"
      >
        ⌨
      </button>
    </div>
  )
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div style={s.overlay}>{children}</div>
}

function Status({ icon, title, sub }: { icon?: string; title: string; sub: string }) {
  return (
    <>
      {icon && <div style={s.icon}>{icon}</div>}
      <p style={s.statusTitle}>{title}</p>
      <p style={s.statusSub}>{sub}</p>
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed', inset: 0, background: '#000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', touchAction: 'none'
  },
  video: {
    width: '100%', height: '100%', objectFit: 'contain', display: 'block',
    userSelect: 'none', WebkitUserSelect: 'none'
  },
  hiddenInput: {
    position: 'absolute', opacity: 0, width: 1, height: 1, top: -100, left: -100, pointerEvents: 'none'
  },
  kbdBtn: {
    position: 'absolute', bottom: 24, right: 24, width: 52, height: 52,
    borderRadius: '50%', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.25)', color: '#fff', fontSize: 22,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10
  },
  overlay: {
    position: 'fixed', inset: 0, background: '#111827',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: 32,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#f9fafb'
  },
  icon: { fontSize: 48, marginBottom: 8 },
  statusTitle: { fontSize: 20, fontWeight: 700, margin: 0, textAlign: 'center' },
  statusSub: { fontSize: 14, color: '#9ca3af', margin: 0, textAlign: 'center', maxWidth: 280 },
  spinner: {
    width: 40, height: 40, border: '3px solid #374151', borderTop: '3px solid #3b82f6',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: 8
  },
  retryBtn: {
    marginTop: 8, padding: '12px 28px', background: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer'
  }
}
