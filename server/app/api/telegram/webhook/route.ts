import { sendTelegramMessage } from '@/lib/telegram'
import {
  handleList,
  handlePair,
  handleUnpair,
  helpReply,
  startReply
} from '@/lib/telegram-handlers'

interface TelegramMessage {
  chat: { id: number }
  from?: { username?: string }
  text?: string
}

interface TelegramUpdate {
  message?: TelegramMessage
}

export async function POST(req: Request): Promise<Response> {
  // Defense against webhook spoofing: only Telegram knows this secret because
  // it was registered with setWebhook(secret_token=...).
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  let update: TelegramUpdate | null = null
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return new Response('ok')
  }

  const message = update?.message
  if (!message?.text) return new Response('ok')

  const chatId = message.chat.id
  const username = message.from?.username ?? null
  const text = message.text.trim()
  const parts = text.split(/\s+/)
  // Strip "@botname" suffix in group chats (e.g. /pair@FocusBot)
  const cmd = parts[0].split('@')[0]
  const args = parts.slice(1)

  let reply: string
  try {
    switch (cmd) {
      case '/start':
        reply = startReply()
        break
      case '/help':
        reply = helpReply()
        break
      case '/pair': {
        const nicknameArg = args.slice(1).join(' ').trim()
        reply = await handlePair(chatId, username, args[0], nicknameArg || null)
        break
      }
      case '/unpair':
        reply = await handleUnpair(chatId, args[0])
        break
      case '/list':
        reply = await handleList(chatId)
        break
      default:
        reply = 'Unknown command\\. Try /help\\.'
    }
  } catch (e) {
    console.error('[telegram-webhook]', e)
    reply = '✗ Internal error\\. Please try again\\.'
  }

  await sendTelegramMessage(chatId, reply)
  // Always 200 — Telegram disables the webhook after repeated non-2xx replies.
  return new Response('ok')
}
