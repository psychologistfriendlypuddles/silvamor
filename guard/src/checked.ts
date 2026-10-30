import { DatabaseSync } from 'node:sqlite'

// The runs the guard has found valid, as it took them or in a sweep, kept in a small SQLite file of
// its own beside the relay's database. The sweep doesn't judge these again on their fees, day or
// shape: they passed when they arrived, and the game's rules or the day's block may have changed
// since. Only run ids and dates are kept, no keys.

export class CheckedRuns {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    // One write for each run taken, while the relay waits for the answer, so no disk sync for each:
    // only a power cut can lose the last few, which the next sweep then checks in full.
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS checked_runs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    `)
  }

  has(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM checked_runs WHERE id = ?').get(id)
  }

  /** Remembers a run found valid, made at `createdAt` (unix seconds). */
  add(id: string, createdAt: number) {
    this.db.prepare('INSERT OR IGNORE INTO checked_runs (id, created_at) VALUES (?, ?)').run(id, createdAt)
  }

  /** Forgets these runs: deleted because their key asked to vanish. */
  forget(ids: string[]) {
    const remove = this.db.prepare('DELETE FROM checked_runs WHERE id = ?')
    for (const id of ids) remove.run(id)
  }

  /** Forgets the runs made before `time` (unix seconds): clean-up has deleted them. */
  forgetBefore(time: number) {
    this.db.prepare('DELETE FROM checked_runs WHERE created_at < ?').run(time)
  }

  close() {
    this.db.close()
  }
}
