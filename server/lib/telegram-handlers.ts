import { db } from '@/db'
import { pairingTokens, telegramChats, telegramPairings } from '@/db/schema'
import { and, eq, gt, sql } from 'drizzle-orm'
import { escapeMarkdownV2 } from './telegram'

const ID8_RE = /^[0-9a-f]{8}$/i

function fmtId(id: string): string {
  return id.slice(0, 8)
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
    '`/unpair <id>` — remove a pairing \\(id from /list\\)',
    '`/list` — show all paired desktops',
    '`/help` — show this message'
  ].join('\n')
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
    return `✓ Paired with Desktop \`${id8}\` \\(as *${escapeMarkdownV2(nickname)}*\\)\\. Use \`/unpair ${id8}\` to remove\\.`
  }
  return `✓ Paired with Desktop \`${id8}\`\\. Use \`/unpair ${id8}\` to remove\\.`
}

export async function handleUnpair(
  chatId: number,
  idArg: string | undefined
): Promise<string> {
  if (!idArg) return 'Usage: `/unpair <id>` \\(id is shown by /list\\)\\.'
  if (!ID8_RE.test(idArg)) {
    return '✗ Invalid id\\. Expected an 8\\-character hex identifier from /list\\.'
  }
  const id8 = idArg.toLowerCase()

  const deleted = await db
    .delete(telegramPairings)
    .where(
      and(
        eq(telegramPairings.chatId, chatId),
        sql`substr(${telegramPairings.desktopId}::text, 1, 8) = ${id8}`
      )
    )
    .returning()

  if (deleted.length === 0) {
    return `ℹ No pairing found with id \`${id8}\`\\. Use /list to see your paired desktops\\.`
  }
  return `✓ Unpaired from Desktop \`${id8}\`\\.`
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
