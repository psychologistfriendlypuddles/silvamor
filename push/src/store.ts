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
    `)
  }

  addSubscription(pubkey: string, sub: PushSubscriptionData) {
    this.db
      .prepare('INSERT OR REPLACE INTO subscriptions (endpoint, pubkey, keys, created_at) VALUES (?, ?, ?, ?)')
      .run(sub.endpoint, pubkey, JSON.stringify(sub.keys), Date.now())
    // A replaced row gets a new rowid, so the newest are the ones with the highest.
    this.db
      .prepare('DELETE FROM subscriptions WHERE pubkey = ? AND rowid NOT IN (SELECT rowid FROM subscriptions WHERE pubkey = ? ORDER BY rowid DESC LIMIT ?)')
      .run(pubkey, pubkey, MAX_SUBSCRIPTIONS_PER_KEY)
  }

  /** Removes a subscription; with `pubkey`, only if it belongs to them. */
  removeSubscription(endpoint: string, pubkey?: string): boolean {
    const result = pubkey
      ? this.db.prepare('DELETE FROM subscriptions WHERE endpoint = ? AND pubkey = ?').run(endpoint, pubkey)
      : this.db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint)
    return Number(result.changes) > 0
  }

  subscriptionsFor(pubkey: string): PushSubscriptionData[] {
    const rows = this.db.prepare('SELECT endpoint, keys FROM subscriptions WHERE pubkey = ?').all(pubkey) as { endpoint: string; keys: string }[]
    return rows.map((r) => ({ endpoint: r.endpoint, keys: JSON.parse(r.keys) }))
  }

  pubkeys(): string[] {
    return (this.db.prepare('SELECT DISTINCT pubkey FROM subscriptions').all() as { pubkey: string }[]).map((r) => r.pubkey)
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
}
