import { DatabaseSync } from 'node:sqlite'

// Deletes old events from nostr-rs-relay's SQLite database, which has no retention setting of
// its own. Written against its schema (DB version 18): an `event` table with `kind` and
// `created_at`, whose `tag` rows go with it (ON DELETE CASCADE).

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
  const db = new DatabaseSync(dbPath)
  try {
    // The relay keeps writing meanwhile: wait for its locks rather than fail.
    db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;')
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version < 18) throw new Error(`Unexpected nostr-rs-relay database version ${version} (cleanup expects 18 or later)`)
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
