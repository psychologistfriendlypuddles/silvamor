import { DatabaseSync } from 'node:sqlite'

export interface PushSubscriptionData {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Browsers one key can get reminders on: a new one replaces the oldest, so no key can pile them up. */
export const MAX_SUBSCRIPTIONS_PER_KEY = 5

/** Everything the service remembers, in one SQLite file (or ':memory:' for tests). */
export class Store {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        endpoint TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        keys TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS subscriptions_pubkey ON subscriptions (pubkey);
      -- Notices already pushed (or deliberately skipped), so each goes out once.
      CREATE TABLE IF NOT EXISTS sent (pubkey TEXT NOT NULL, notice TEXT NOT NULL, PRIMARY KEY (pubkey, notice));
      -- Each key with a browser here: when it was last seen playing (or signing up), and last looked up
      -- with the relays answering (ms).
      CREATE TABLE IF NOT EXISTS players (pubkey TEXT PRIMARY KEY, seen_at INTEGER NOT NULL, checked_at INTEGER);
      CREATE INDEX IF NOT EXISTS players_seen ON players (seen_at);
    `)
    // Keys that signed up before players were kept start with a fresh 30 days.
    this.db.prepare('INSERT OR IGNORE INTO players (pubkey, seen_at) SELECT DISTINCT pubkey, ? FROM subscriptions').run(Date.now())
    this.db.exec('DELETE FROM players WHERE pubkey NOT IN (SELECT pubkey FROM subscriptions)')
  }

  /** Adds (or renews) a browser for `pubkey`. Signing up counts as being seen. */
  addSubscription(pubkey: string, sub: PushSubscriptionData) {
    const previous = this.ownerOf(sub.endpoint)
    this.db
      .prepare('INSERT OR REPLACE INTO subscriptions (endpoint, pubkey, keys, created_at) VALUES (?, ?, ?, ?)')
      .run(sub.endpoint, pubkey, JSON.stringify(sub.keys), Date.now())
    // A replaced row gets a new rowid, so the newest are the ones with the highest.
    this.db
      .prepare('DELETE FROM subscriptions WHERE pubkey = ? AND rowid NOT IN (SELECT rowid FROM subscriptions WHERE pubkey = ? ORDER BY rowid DESC LIMIT ?)')
      .run(pubkey, pubkey, MAX_SUBSCRIPTIONS_PER_KEY)
    this.db
      .prepare('INSERT INTO players (pubkey, seen_at) VALUES (?, ?) ON CONFLICT (pubkey) DO UPDATE SET seen_at = max(seen_at, excluded.seen_at)')
      .run(pubkey, Date.now())
    // A browser moving to another key (two accounts on one browser) may leave the first with none.
    if (previous && previous !== pubkey) this.dropIfNoBrowsers(previous)
  }

  /** Removes a subscription; with `pubkey`, only if it belongs to them. */
  removeSubscription(endpoint: string, pubkey?: string): boolean {
    const owner = this.ownerOf(endpoint)
    if (!owner || (pubkey && owner !== pubkey)) return false
    this.db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint)
    this.dropIfNoBrowsers(owner)
    return true
  }

  hasSubscription(endpoint: string): boolean {
    return !!this.ownerOf(endpoint)
  }

  subscriptionsFor(pubkey: string): PushSubscriptionData[] {
    const rows = this.db.prepare('SELECT endpoint, keys FROM subscriptions WHERE pubkey = ?').all(pubkey) as { endpoint: string; keys: string }[]
    return rows.map((r) => ({ endpoint: r.endpoint, keys: JSON.parse(r.keys) }))
  }

  pubkeys(): string[] {
    return (this.db.prepare('SELECT DISTINCT pubkey FROM subscriptions').all() as { pubkey: string }[]).map((r) => r.pubkey)
  }

  /** Keys not yet sent `notice`, and not looked up since `checkedBefore` (ms). */
  due(notice: string, checkedBefore: number): string[] {
    const rows = this.db
      .prepare('SELECT pubkey FROM players WHERE (checked_at IS NULL OR checked_at <= ?) AND NOT EXISTS (SELECT 1 FROM sent WHERE sent.pubkey = players.pubkey AND notice = ?)')
      .all(checkedBefore, notice) as { pubkey: string }[]
    return rows.map((r) => r.pubkey)
  }

  /** Records that `pubkeys` were looked up, with the relays answering, at `at` (ms). */
  checked(pubkeys: string[], at: number) {
    this.update('UPDATE players SET checked_at = ? WHERE pubkey = ?', pubkeys, at)
  }

  /** Records that `pubkeys` were seen playing at `at` (ms). */
  seen(pubkeys: string[], at: number) {
    this.update('UPDATE players SET seen_at = max(seen_at, ?) WHERE pubkey = ?', pubkeys, at)
  }

  /**
   * Lets go of keys not seen playing (or signing up) since `seenBefore` (ms), browsers and all, and of
   * notices other than `keep`, the only ones still asked about. Says how many keys went.
   */
  forget(seenBefore: number, keep: string[]): number {
    this.db.prepare('DELETE FROM subscriptions WHERE pubkey IN (SELECT pubkey FROM players WHERE seen_at < ?)').run(seenBefore)
    const gone = Number(this.db.prepare('DELETE FROM players WHERE seen_at < ?').run(seenBefore).changes)
    this.db.prepare(`DELETE FROM sent WHERE notice NOT IN (${keep.map(() => '?').join(', ')})`).run(...keep)
    return gone
  }

  wasSent(pubkey: string, notice: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sent WHERE pubkey = ? AND notice = ?').get(pubkey, notice)
  }

  markSent(pubkey: string, notices: string[]) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO sent (pubkey, notice) VALUES (?, ?)')
    for (const n of notices) insert.run(pubkey, n)
  }

  close() {
    this.db.close()
  }

  private ownerOf(endpoint: string): string | undefined {
    return (this.db.prepare('SELECT pubkey FROM subscriptions WHERE endpoint = ?').get(endpoint) as { pubkey: string } | undefined)?.pubkey
  }

  /** A key with no browsers left isn't kept: turning reminders off leaves nothing behind but the day's notices. */
  private dropIfNoBrowsers(pubkey: string) {
    this.db.prepare('DELETE FROM players WHERE pubkey = ? AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE pubkey = ?)').run(pubkey, pubkey)
  }

  /** Runs `sql` with (`at`, pubkey) for each of `pubkeys`, in one transaction. */
  private update(sql: string, pubkeys: string[], at: number) {
    const statement = this.db.prepare(sql)
    this.db.exec('BEGIN')
    try {
      for (const pubkey of pubkeys) statement.run(at, pubkey)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
}
