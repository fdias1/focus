// One-time setup: registers the Telegram webhook URL and configures the
// command autocomplete list shown in the Telegram client.
//
// Usage:
//   node --env-file=.env.local scripts/setup-telegram-webhook.mjs
//   node --env-file=.env.local scripts/setup-telegram-webhook.mjs https://my-preview.vercel.app/api/telegram/webhook

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
const URL =
  process.argv[2] || 'https://focus-server-three.vercel.app/api/telegram/webhook'

if (!TOKEN || !SECRET) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in your env first.')
  console.error('Typical run: node --env-file=.env.local scripts/setup-telegram-webhook.mjs')
  process.exit(1)
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  console.log(`${method}:`, JSON.stringify(json))
  if (!json.ok) process.exit(1)
}

await call('setWebhook', {
  url: URL,
  secret_token: SECRET,
  allowed_updates: ['message'],
  drop_pending_updates: true
})

await call('setMyCommands', {
  commands: [
    { command: 'pair', description: 'Pair this chat with a desktop (uses code from the app)' },
    { command: 'unpair', description: 'Remove a desktop pairing by id' },
    { command: 'list', description: 'List all paired desktops' },
    { command: 'help', description: 'Show help' }
  ]
})

console.log(`\nWebhook set: ${URL}`)
