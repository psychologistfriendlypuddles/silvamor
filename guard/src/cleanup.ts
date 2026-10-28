import { DatabaseSync } from 'node:sqlite'
import { hexToBytes } from 'nostr-tools/utils'
import type { Event } from 'nostr-tools/pure'
import type { Decision } from './policy'

// Deletes old events from nostr-rs-relay's SQLite database, which has no retention setting of
// its own, everything from a key that asks to vanish, and runs the guard would have refused. Written
// against its schema (DB version 18): an `event` table with `kind`, `created_at` and `first_seen`
// (when the relay got it), whose `tag` rows go with it (ON DELETE CASCADE).

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

/**
 * The streaks `pubkey`'s Block of the Day runs for `day` claim, as stored here; null if a stored event
 * can't be read (then nothing is checked). The relay keeps each event's JSON in `content` and
 * indexes single-letter tags, such as the day label `l`.
 */
export function storedStreaks(dbPath: string, pubkey: string, day: string): number[] | null {
  const db = open(dbPath)
  try {
    const rows = db
      .prepare("SELECT e.content FROM event e JOIN tag t ON t.event_id = e.id WHERE e.author = ? AND e.kind = 1953 AND t.name = 'l' AND t.value = ?")
      .all(hexToBytes(pubkey), day) as { content: string }[]
    const streaks: number[] = []
    for (const { content } of rows) {
      const tags = (JSON.parse(content) as { tags?: unknown }).tags
      if (!Array.isArray(tags)) return null
      const claimed = Number(tags.find((t) => Array.isArray(t) && t[0] === 'streak')?.[1])
      streaks.push(Number.isSafeInteger(claimed) && claimed >= 1 ? claimed : 1)
    }
    return streaks
  } catch {
    return null
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

/** What a sweep did: the runs it checked, how many failed and why, and how many it couldn't check yet. */
export interface Swept {
  checked: number
  failed: Map<string, number>
  later: number
}

/**
 * Checks the Block of the Day runs the relay got since `since` (its `first_seen`, unix seconds) again,
 * each as it reached the relay, and deletes the ones `check` refuses; with `dryRun`, only counts them.
 * Days go oldest first, so a run that fails once the day before's run it extends is deleted goes too.
 * Runs `check` can't tell about yet are left for the next sweep.
 */
export async function sweepRuns(dbPath: string, since: number, check: (event: Event, at: number) => Promise<Decision>, opts: { dryRun: boolean }): Promise<Swept> {
  const swept: Swept = { checked: 0, failed: new Map(), later: 0 }
  const db = open(dbPath)
  try {
    const labelled = "FROM event e JOIN tag t ON t.event_id = e.id WHERE e.kind = 1953 AND t.name = 'l' AND e.first_seen >= ?"
    const days = db.prepare(`SELECT DISTINCT t.value AS day ${labelled} ORDER BY day`).all(since) as { day: string }[]
    const runsOn = db.prepare(`SELECT DISTINCT e.event_hash AS hash, e.content, e.first_seen AS at ${labelled} AND t.value = ?`)
    const remove = db.prepare('DELETE FROM event WHERE event_hash = ?')
    for (const { day } of days) {
      const runs = (runsOn.all(since, day) as { hash: Uint8Array; content: string; at: number }[])
        .map((row) => ({ ...row, event: JSON.parse(row.content) as Event }))
        .sort((a, b) => a.event.created_at - b.event.created_at)
      for (const { hash, event, at } of runs) {
        // The relay waits on the guard's every answer: let its requests in between.
        if (++swept.checked % 100 === 0) await new Promise((resolve) => setImmediate(resolve))
        const decision = await check(event, at)
        if (decision.permit) continue
        if (decision.later) {
          swept.later++
          continue
        }
        const why = decision.message ?? 'refused'
        swept.failed.set(why, (swept.failed.get(why) ?? 0) + 1)
        if (!opts.dryRun) remove.run(hash)
      }
    }
    return swept
  } finally {
    db.close()
  }
}

/** Keep events of `kind` for `days` days after they were created. */
export interface Retention {
  kind: number
  days: number
}

/** "1953:30,1984:365" → [{ kind: 1953, days: 30 }, { kind: 1984, days: 365 }] */
export function parseRetention(value: string | undefined): Retention[] {
  if (!value?.trim()) return []
  return value.split(',').map((part) => {
    const [kind, days] = part.split(':').map((s) => Number(s.trim()))
    if (!Number.isSafeInteger(kind) || kind < 0 || !Number.isSafeInteger(days) || days < 1) {
      throw new Error(`RETENTION: "${part.trim()}" should be kind:days, e.g. 1953:30`)
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
