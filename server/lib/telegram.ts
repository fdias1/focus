const API_BASE = 'https://api.telegram.org/bot'

export interface SendResult {
  ok: boolean
  statusCode: number
  description?: string
}

/**
 * Sends a Telegram message via the Bot API. Returns ok=false on transport or
 * API errors; callers should check statusCode/description for cleanup decisions
 * (e.g. 403 "bot was blocked" or 400 "chat not found" → drop the pairing).
 */
export async function sendTelegramMessage(
  chatId: number,
  text: string,
  opts: { parseMode?: 'MarkdownV2' | 'HTML' } = {}
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, statusCode: 0, description: 'TELEGRAM_BOT_TOKEN not set' }

  const res = await fetch(`${API_BASE}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode ?? 'MarkdownV2',
      disable_web_page_preview: true
    })
  }).catch((e) => ({ ok: false, status: 0, _err: e } as unknown as Response & { _err: unknown }))

  const r = res as Response & { _err?: unknown }
  if (r._err !== undefined) return { ok: false, statusCode: 0, description: String(r._err) }

  let body: { description?: string } = {}
  try { body = (await r.json()) as { description?: string } } catch { /* ignore */ }
  return { ok: r.ok, statusCode: r.status, description: body.description }
}

/**
 * Escapes a string for Telegram's MarkdownV2 parse mode.
 * Per https://core.telegram.org/bots/api#markdownv2-style every reserved
 * character must be backslash-escaped.
 */
export function escapeMarkdownV2(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

/**
 * Sends a photo via the Bot API. Same SendResult contract as sendTelegramMessage —
 * statusCode/description let callers prune dead pairings consistently.
 */
export async function sendTelegramPhoto(
  chatId: number,
  photo: Buffer,
  caption: string,
  opts: { parseMode?: 'MarkdownV2' | 'HTML' } = {}
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, statusCode: 0, description: 'TELEGRAM_BOT_TOKEN not set' }

  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('caption', caption)
  form.append('parse_mode', opts.parseMode ?? 'MarkdownV2')
  form.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'screen.png')

  const res = await fetch(`${API_BASE}${token}/sendPhoto`, {
    method: 'POST',
    body: form
  }).catch((e) => ({ ok: false, status: 0, _err: e } as unknown as Response & { _err: unknown }))

  const r = res as Response & { _err?: unknown }
  if (r._err !== undefined) return { ok: false, statusCode: 0, description: String(r._err) }

  let body: { description?: string } = {}
  try { body = (await r.json()) as { description?: string } } catch { /* ignore */ }
  return { ok: r.ok, statusCode: r.status, description: body.description }
}
