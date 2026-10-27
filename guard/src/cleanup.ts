import { DatabaseSync } from 'node:sqlite'
import { hexToBytes } from 'nostr-tools/utils'

// Deletes old events from nostr-rs-relay's SQLite database, which has no retention setting of
// its own, and everything from a key that asks to vanish. Written against its schema (DB version 18): an `event` table with `kind` and
// `created_at`, whose `tag` rows go with it (ON DELETE CASCADE).

/** NIP-62 "request to vanish": a key asks the relay to delete everything it published. */
export const VANISH_KIND = 62

function open(dbPath: string) {
  const db = new DatabaseSync(dbPath)
  // The relay keeps writing meanwhile: wait for its locks rather than fail.
  db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;')
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version < 18) {
    db.close()
    throw new Error(`Unexpected nostr-rs-relay database version ${version} (cleanup expects 18 or later)`)
  }
  return db
}

/**
 * Deletes every event `pubkey` (hex) published up to `before` (unix seconds), as its request to
 * vanish asks. Earlier vanish requests stay, so the relay keeps refusing those events if someone
 * uploads them again. Returns how many events were deleted.
 */
export function erase(dbPath: string, pubkey: string, before: number): number {
  const db = open(dbPath)
  try {
    const author = hexToBytes(pubkey)
    const mine = 'SELECT id FROM event WHERE author = ? AND created_at <= ? AND kind != ?'
    db.exec('BEGIN')
    try {
      // NIP-05 checks point at profiles; the relay only has this table when it does them.
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_verification'").get()) {
        db.prepare(`DELETE FROM user_verification WHERE metadata_event IN (${mine})`).run(author, before, VANISH_KIND)
      }
      const n = Number(db.prepare(`DELETE FROM event WHERE id IN (${mine})`).run(author, before, VANISH_KIND).changes)
      db.exec('COMMIT')
      return n
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    db.close()
  }
}

/** Every key that asked to vanish, with the time of its latest request (unix seconds). */
export function vanishRequests(dbPath: string): Map<string, number> {
  const db = open(dbPath)
  try {
    const rows = db.prepare('SELECT hex(author) AS author, MAX(created_at) AS at FROM event WHERE kind = ? GROUP BY author').all(VANISH_KIND) as { author: string; at: number }[]
    return new Map(rows.map((r) => [r.author.toLowerCase(), Number(r.at)]))
  } finally {
    db.close()
  }
}

/** Keep events of `kind` for `days` days after they were created. */
export interface Retention {
  kind: number
  days: number
}

/** "1952:30,1984:365" → [{ kind: 1952, days: 30 }, { kind: 1984, days: 365 }] */
export function parseRetention(value: string | undefined): Retention[] {
  if (!value?.trim()) return []
  return value.split(',').map((part) => {
    const [kind, days] = part.split(':').map((s) => Number(s.trim()))
    if (!Number.isSafeInteger(kind) || kind < 0 || !Number.isSafeInteger(days) || days < 1) {
      throw new Error(`RETENTION: "${part.trim()}" should be kind:days, e.g. 1952:30`)
    }
    return { kind, days }
  })
}

/**
 * Deletes events older than each rule allows; with `dryRun`, only counts them. Returns how many
 * events of each kind were (or would be) deleted.
 */
export function prune(dbPath: string, rules: Retention[], opts: { dryRun: boolean; now?: number }): Record<number, number> {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const db = open(dbPath)
  try {
    const counts: Record<number, number> = {}
    for (const { kind, days } of rules) {
      const cutoff = now - days * 86400
      counts[kind] = opts.dryRun
        ? Number((db.prepare('SELECT COUNT(*) AS n FROM event WHERE kind = ? AND created_at < ?').get(kind, cutoff) as { n: number }).n)
        : Number(db.prepare('DELETE FROM event WHERE kind = ? AND created_at < ?').run(kind, cutoff).changes)
    }
    return counts
  } finally {
    db.close()
  }
}
