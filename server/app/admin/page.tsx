'use client'

import { useEffect, useRef, useState } from 'react'

const SERVER = ''  // empty = same origin

interface Pairing {
  id: string
  desktopId: string
  nickname: string | null
  createdAt: string
}

function getClientId(): string {
  let id = localStorage.getItem('focus_client_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('focus_client_id', id)
  }
  return id
}

async function ensureRegistered(clientId: string) {
  await fetch(`${SERVER}/api/client/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId })
  })
}

export default function AdminPage() {
  const [clientId, setClientId] = useState<string>('')
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [token, setToken] = useState('')
  const [nickname, setNickname] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    const id = getClientId()
    setClientId(id)
    ensureRegistered(id).then(() => fetchPairings(id))
  }, [])

  async function fetchPairings(id = clientId) {
    const res = await fetch(`${SERVER}/api/pairings/client/${id}`)
    if (res.ok) setPairings(await res.json())
  }

  async function confirmPairing() {
    if (!token.trim()) return
    setStatus('Pairing…')
    const res = await fetch(`${SERVER}/api/pairing/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim().toUpperCase(), clientId, nickname: nickname || undefined })
    })
    if (res.ok) {
      setStatus('Paired!')
      setToken('')
      setNickname('')
      fetchPairings()
    } else {
      const { error } = await res.json()
      setStatus(`Error: ${error}`)
    }
  }

  async function removePairing(pairingId: string) {
    await fetch(`${SERVER}/api/pairing/${pairingId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    })
    fetchPairings()
  }

  return (
    <main style={s.page}>
      <h1 style={s.h1}>Focus Admin</h1>
      <p style={s.muted}>Client ID: <code>{clientId}</code></p>

      <section style={s.section}>
        <h2 style={s.h2}>Paired Desktops</h2>
        {pairings.length === 0 && <p style={s.muted}>No paired desktops.</p>}
        {pairings.map((p) => (
          <div key={p.id} style={s.row}>
            <div>
              <strong>{p.nickname ?? `Desktop-${p.desktopId.slice(0, 8)}`}</strong>
              <span style={s.muted}> · {p.desktopId.slice(0, 8)}</span>
              <div style={s.muted}>{new Date(p.createdAt).toLocaleDateString()}</div>
            </div>
            <button style={s.deleteBtn} onClick={() => removePairing(p.id)}>Remove</button>
          </div>
        ))}
      </section>

      <section style={s.section}>
        <h2 style={s.h2}>Add Pairing</h2>
        <p style={s.muted}>Enter the 6-character token shown in Focus Desktop.</p>
        <input
          style={s.input}
          placeholder="Token (e.g. AB3X9Z)"
          value={token}
          onChange={(e) => setToken(e.target.value.toUpperCase())}
          maxLength={6}
        />
        <input
          style={s.input}
          placeholder="Nickname (optional)"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <button style={s.btn} onClick={confirmPairing}>Confirm Pairing</button>
        {status && <p style={s.muted}>{status}</p>}
      </section>
    </main>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { fontFamily: '-apple-system, sans-serif', maxWidth: 560, margin: '0 auto', padding: 32 },
  h1: { fontSize: 24, fontWeight: 700, marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
  muted: { color: '#6b7280', fontSize: 13 },
  section: { marginTop: 32 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #e5e7eb' },
  input: { display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, marginBottom: 8, boxSizing: 'border-box' },
  btn: { padding: '8px 16px', background: '#111827', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  deleteBtn: { padding: '6px 12px', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }
}
