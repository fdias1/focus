import { json } from '@/lib/auth'

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return Response.json({ error: 'VAPID not configured' }, { status: 500 })
  return json({ publicKey: key })
}
