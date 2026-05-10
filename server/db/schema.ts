import { pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core'

export const desktopDevices = pgTable('desktop_devices', {
  id: uuid('id').primaryKey(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const clientDevices = pgTable('client_devices', {
  id: uuid('id').primaryKey(),
  pushToken: text('push_token'),
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

// One row per (bountyBoxId, desktopId) — prevents duplicate push deliveries.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').notNull(),
    desktopId: uuid('desktop_id')
      .notNull()
      .references(() => desktopDevices.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [unique().on(t.id, t.desktopId)]
)
