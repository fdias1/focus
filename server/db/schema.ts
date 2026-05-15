import { pgTable, text, timestamp, uuid, unique, index, bigint } from 'drizzle-orm/pg-core'

export const desktopDevices = pgTable('desktop_devices', {
  id: uuid('id').primaryKey(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  pendingMonitorAt: timestamp('pending_monitor_at', { withTimezone: true }),
  pendingReleaseAt: timestamp('pending_release_at', { withTimezone: true })
})

export const clientDevices = pgTable('client_devices', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const pairings = pgTable(
  'pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    desktopId: uuid('desktop_id')
      .notNull()
      .references(() => desktopDevices.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientDevices.id, { onDelete: 'cascade' }),
    nickname: text('nickname'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [unique().on(t.desktopId, t.clientId)]
)

export const pairingTokens = pgTable('pairing_tokens', {
  token: text('token').primaryKey(),
  desktopId: uuid('desktop_id')
    .notNull()
    .references(() => desktopDevices.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
})

// Web Push subscriptions — one per browser/device, owned by a client.
export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientDevices.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    // Full PushSubscription JSON: { endpoint, keys: { p256dh, auth } }
    subscription: text('subscription').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index('web_push_client_idx').on(t.clientId),
    unique('web_push_client_endpoint_uniq').on(t.clientId, t.endpoint)
  ]
)

// A Telegram chat that has interacted with the bot. chatId comes from Telegram
// (BIGINT to fit IDs that can exceed 2^31).
export const telegramChats = pgTable('telegram_chats', {
  chatId: bigint('chat_id', { mode: 'number' }).primaryKey(),
  username: text('username'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

// Pairing between a desktop session and a Telegram chat. Parallel to `pairings`
// (desktop ↔ PWA client) — same semantics, separate channel.
export const telegramPairings = pgTable(
  'telegram_pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    desktopId: uuid('desktop_id')
      .notNull()
      .references(() => desktopDevices.id, { onDelete: 'cascade' }),
    chatId: bigint('chat_id', { mode: 'number' })
      .notNull()
      .references(() => telegramChats.chatId, { onDelete: 'cascade' }),
    nickname: text('nickname'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [unique().on(t.desktopId, t.chatId), index('tg_pairings_chat_idx').on(t.chatId)]
)

// Tracks each /monitor invocation per desktop. State machine:
//   pending → delivered (consumed by /api/poll) → confirmed (acked by desktop)
// Used so /monitor in Telegram waits for actual desktop confirmation before
// replying to the user.
export const monitorCommands = pgTable(
  'monitor_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    desktopId: uuid('desktop_id')
      .notNull()
      .references(() => desktopDevices.id, { onDelete: 'cascade' }),
    chatId: bigint('chat_id', { mode: 'number' })
      .notNull()
      .references(() => telegramChats.chatId, { onDelete: 'cascade' }),
    state: text('state').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true })
  },
  (t) => [
    index('monitor_commands_desktop_state_idx').on(t.desktopId, t.state),
    index('monitor_commands_chat_idx').on(t.chatId)
  ]
)

