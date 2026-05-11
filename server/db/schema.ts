import { pgTable, text, timestamp, uuid, unique, index } from 'drizzle-orm/pg-core'

export const desktopDevices = pgTable('desktop_devices', {
  id: uuid('id').primaryKey(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
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

// Notification log — one row per desktop trigger event (24 h window).
// Used to replay missed notifications when a new push subscription is created.
export const desktopNotifications = pgTable(
  'desktop_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    desktopId: uuid('desktop_id')
      .notNull()
      .references(() => desktopDevices.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index('notif_desktop_sent_idx').on(t.desktopId, t.sentAt)]
)

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

