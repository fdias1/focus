import { SERVER_URL } from './constants'

export interface Pairing {
  id: string
  desktopId: string
  nickname: string | null
  createdAt: string
}

export async function registerClient(clientId: string): Promise<void> {
  await fetch(`${SERVER_URL}/api/client/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId })
  })
}

export async function updatePushToken(clientId: string, pushToken: string): Promise<void> {
  await fetch(`${SERVER_URL}/api/client/push-token`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, pushToken })
  })
}

export async function getPairings(clientId: string): Promise<Pairing[]> {
  const res = await fetch(`${SERVER_URL}/api/pairings/client/${clientId}`)
  if (!res.ok) return []
  return res.json()
}

export async function confirmPairing(
  token: string,
  clientId: string,
  pushToken: string | null,
  nickname?: string
): Promise<{ pairingId: string | null; desktopId: string } | null> {
  const res = await fetch(`${SERVER_URL}/api/pairing/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      clientId,
      pushToken: pushToken ?? undefined,
      nickname: nickname || undefined
    })
  })
  if (!res.ok) return null
  return res.json()
}

export async function removePairing(pairingId: string, clientId: string): Promise<void> {
  await fetch(`${SERVER_URL}/api/pairing/${pairingId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId })
  })
}
