import { db } from '@/db'
import {
  desktopDevices,
  monitorCommands,
  pairingTokens,
  telegramChats,
  telegramPairings
} from '@/db/schema'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { escapeMarkdownV2 } from './telegram'

const MONITOR_CONFIRM_TIMEOUT_MS = 25_000
const MONITOR_CONFIRM_POLL_MS = 1_000

function fmtId(id: string): string {
  return id.slice(0, 8)
}

/**
 * Returns the desktopId at 1-indexed position from the ordered pairing list,
 * or an error string if the position is out of range or invalid.
 */
async function resolvePosition(
  chatId: number,
  posArg: string | undefined
): Promise<{ desktopId: string; nickname: string | null } | { error: string }> {
  const pos = posArg !== undefined ? parseInt(posArg, 10) : NaN
  if (isNaN(pos) || pos < 1) {
    return { error: '✗ Provide a position number from /list \\(e\\.g\\. `1`\\)\\.' }
  }
  const rows = await db
    .select({ desktopId: telegramPairings.desktopId, nickname: telegramPairings.nickname })
    .from(telegramPairings)
    .where(eq(telegramPairings.chatId, chatId))
    .orderBy(telegramPairings.createdAt)
  if (pos > rows.length) {
    return {
      error: `✗ No desktop at position ${pos}\\. Use /list to see your paired desktops\\.`
    }
  }
  return rows[pos - 1]
}

export function startReply(): string {
  return [
    '👋 Welcome to *Focus*\\.',
    '',
    'This bot delivers screen\\-change alerts from your paired desktops\\.',
    '',
    'To pair: open Focus on desktop → *Pair Device* → copy the 6\\-char code → run `/pair <code>` here\\.',
    '',
    'Type /help for the full command list\\.'
  ].join('\n')
}

export function helpReply(): string {
  return [
    '*Commands*',
    '',
    '`/pair <code> [nickname]` — pair this chat with a desktop',
    '`/unpair <number>` — remove a pairing \\(number from /list\\)',
    '`/rename <number> [nickname]` — set or clear a desktop nickname',
    '`/list` — show all paired desktops',
    '`/monitor [number]` — start monitoring on all or one desktop',
    '`/release [number]` — deactivate Focus on all or one desktop',
    '`/help` — show this message'
  ].join('\n')
}

export async function handleMonitor(chatId: number, posArg?: string): Promise<string> {
  let targets: Array<{ desktopId: string; nickname: string | null }>
  if (posArg !== undefined) {
    const result = await resolvePosition(chatId, posArg)
    if ('error' in result) return result.error
    targets = [result]
  } else {
    targets = await db
      .select({ desktopId: telegramPairings.desktopId, nickname: telegramPairings.nickname })
      .from(telegramPairings)
      .where(eq(telegramPairings.chatId, chatId))
      .orderBy(telegramPairings.createdAt)
    if (targets.length === 0) return 'No paired desktops\\. Use `/pair <code>` first\\.'
  }

  // Insert one command per target. Desktop will pick them up via /api/poll
  // and confirm via /api/monitor-ack after entering MONITORING state.
  const inserted = await db
    .insert(monitorCommands)
    .values(targets.map((t) => ({ desktopId: t.desktopId, chatId })))
    .returning({ id: monitorCommands.id, desktopId: monitorCommands.desktopId })

  // Legacy signal — also flips pendingMonitorAt so older desktop builds still react.
  await db
    .update(desktopDevices)
    .set({ pendingMonitorAt: new Date() })
    .where(inArray(desktopDevices.id, targets.map((t) => t.desktopId)))

  const confirmed = await waitForConfirmations(inserted.map((c) => c.id))

  const commandToDesktop = new Map(inserted.map((c) => [c.id, c.desktopId]))
  const okDesktops = new Set<string>()
  for (const id of confirmed) {
    const d = commandToDesktop.get(id)
    if (d) okDesktops.add(d)
  }

  const lines = targets.map((t) => {
    const label = t.nickname
      ? `*${escapeMarkdownV2(t.nickname)}*`
      : `\`${fmtId(t.desktopId)}\``
    return okDesktops.has(t.desktopId)
      ? `✓ ${label} — monitoring`
      : `✗ ${label} — no response`
  })
  return ['*Monitor status*', '', ...lines].join('\n')
}

async function waitForConfirmations(commandIds: string[]): Promise<Set<string>> {
  const startedAt = Date.now()
  let confirmed = new Set<string>()
  while (
    Date.now() - startedAt < MONITOR_CONFIRM_TIMEOUT_MS &&
    confirmed.size < commandIds.length
  ) {
    await new Promise((r) => setTimeout(r, MONITOR_CONFIRM_POLL_MS))
    const rows = await db
      .select({ id: monitorCommands.id, state: monitorCommands.state })
      .from(monitorCommands)
      .where(inArray(monitorCommands.id, commandIds))
    confirmed = new Set(rows.filter((r) => r.state === 'confirmed').map((r) => r.id))
  }
  return confirmed
}

export async function handleRelease(chatId: number, posArg?: string): Promise<string> {
  if (posArg !== undefined) {
    const result = await resolvePosition(chatId, posArg)
    if ('error' in result) return result.error
    await db
      .update(desktopDevices)
      .set({ pendingReleaseAt: new Date() })
      .where(eq(desktopDevices.id, result.desktopId))
    const label = result.nickname
      ? `*${escapeMarkdownV2(result.nickname)}*`
      : `\`${fmtId(result.desktopId)}\``
    return `✓ Release triggered on ${label}\\.`
  }

  const paired = await db
    .select({ desktopId: telegramPairings.desktopId })
    .from(telegramPairings)
    .where(eq(telegramPairings.chatId, chatId))

  if (paired.length === 0) return 'No paired desktops\\. Use `/pair <code>` first\\.'

  const ids = paired.map((p) => p.desktopId)
  await db
    .update(desktopDevices)
    .set({ pendingReleaseAt: new Date() })
    .where(inArray(desktopDevices.id, ids))

  return `✓ Release triggered on ${ids.length} desktop\\(s\\)\\.`
}

export async function handlePair(
  chatId: number,
  username: string | null,
  code: string | undefined,
  nicknameArg: string | null
): Promise<string> {
  if (!code) return 'Usage: `/pair <code> \\[nickname\\]`'

  const normalized = code.toUpperCase()

  // Atomic consume — DELETE+RETURNING prevents concurrent double-consume.
  // Same pattern as server/app/api/pairing/confirm/route.ts.
  const [pt] = await db
    .delete(pairingTokens)
    .where(and(eq(pairingTokens.token, normalized), gt(pairingTokens.expiresAt, new Date())))
    .returning()
  if (!pt) return '✗ Invalid or expired code\\. Generate a new one in the Focus app\\.'

  await db
    .insert(telegramChats)
    .values({ chatId, username: username ?? null })
    .onConflictDoUpdate({
      target: telegramChats.chatId,
      set: { username: username ?? null }
    })

  const nickname = nicknameArg && nicknameArg.length > 0 ? nicknameArg.slice(0, 64) : null

  const [inserted] = await db
    .insert(telegramPairings)
    .values({ desktopId: pt.desktopId, chatId, nickname })
    .onConflictDoNothing()
    .returning()

  const id8 = fmtId(pt.desktopId)
  if (!inserted) {
    return `ℹ Already paired with Desktop \`${id8}\`\\.`
  }
  if (nickname) {
    return `✓ Paired with Desktop \`${id8}\` \\(as *${escapeMarkdownV2(nickname)}*\\)\\. Use /list to manage pairings\\.`
  }
  return `✓ Paired with Desktop \`${id8}\`\\. Use /list to manage pairings\\.`
}

export async function handleUnpair(chatId: number, posArg: string | undefined): Promise<string> {
  if (!posArg) return 'Usage: `/unpair <number>` \\(number is shown by /list\\)\\.'

  const result = await resolvePosition(chatId, posArg)
  if ('error' in result) return result.error

  const { desktopId, nickname } = result
  await db
    .delete(telegramPairings)
    .where(and(eq(telegramPairings.chatId, chatId), eq(telegramPairings.desktopId, desktopId)))

  const id8 = fmtId(desktopId)
  const label = nickname ? ` \\(*${escapeMarkdownV2(nickname)}*\\)` : ''
  return `✓ Unpaired Desktop \`${id8}\`${label}\\.`
}

export async function handleRename(
  chatId: number,
  posArg: string | undefined,
  newNickname: string
): Promise<string> {
  if (!posArg) return 'Usage: `/rename <number> [nickname]`'

  const result = await resolvePosition(chatId, posArg)
  if ('error' in result) return result.error

  const { desktopId } = result
  const nickname = newNickname.trim().slice(0, 64) || null

  await db
    .update(telegramPairings)
    .set({ nickname })
    .where(and(eq(telegramPairings.chatId, chatId), eq(telegramPairings.desktopId, desktopId)))

  const id8 = fmtId(desktopId)
  if (nickname) {
    return `✓ Desktop \`${id8}\` renamed to *${escapeMarkdownV2(nickname)}*\\.`
  }
  return `✓ Nickname cleared for Desktop \`${id8}\`\\.`
}

export async function handleList(chatId: number): Promise<string> {
  const rows = await db
    .select({
      desktopId: telegramPairings.desktopId,
      nickname: telegramPairings.nickname,
      createdAt: telegramPairings.createdAt
    })
    .from(telegramPairings)
    .where(eq(telegramPairings.chatId, chatId))
    .orderBy(telegramPairings.createdAt)

  if (rows.length === 0) return 'No paired desktops\\.'

  const lines = rows.map((r, i) => {
    const id8 = fmtId(r.desktopId)
    const name = r.nickname ? `*${escapeMarkdownV2(r.nickname)}*` : '_\\(no name\\)_'
    const date = r.createdAt.toISOString().slice(0, 10).replace(/-/g, '\\-')
    return `${i + 1}\\. \`${id8}\` — ${name} — paired ${date}`
  })
  return ['*Paired desktops*', '', ...lines].join('\n')
}
