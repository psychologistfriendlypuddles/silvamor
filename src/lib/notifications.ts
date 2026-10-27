import type { Event } from 'nostr-tools/pure'
import type { Block } from './bitcoin'
import { countedRuns, parseRun, type DailyRun } from './nostr/dailyRuns'

// What's worth telling a player about. The app and the push service (push/) both decide
// with `beatenNotice`, so they can't disagree.

export interface Notice {
  /** Stable, so the same run never notifies twice (even after a reload). */
  id: string
  kind: 'beaten'
  day: string
  /** When it happened (unix seconds). */
  at: number
  /** The friend whose run beat yours. */
  actor: string
  score: number
}

/** What `beatenNotice` needs to look up, from relays (and a Bitcoin block source). */
export interface RunLookup {
  follows(me: string, author: string): Promise<boolean>
  dayBlock(day: string): Promise<Block | null>
  /** The day's runs (kind 1952) by these authors. */
  runs(authors: string[], day: string): Promise<Event[]>
}

/**
 * A run tagging `me` as beaten is news when: its author is someone `me` follows, it's the
 * author's first run of the day (the one that counts), and it beats `me`'s own counted run.
 */
export async function beatenNotice(event: Event, me: string, lookup: RunLookup): Promise<Notice | null> {
  const run = parseRun(event)
  if (!run || run.author === me || !event.tags.some((t) => t[0] === 'p' && t[1] === me)) return null
  if (!(await lookup.follows(me, run.author))) return null
  const block = await lookup.dayBlock(run.day)
  if (!block) return null
  const runs = (await lookup.runs([run.author, me], run.day)).map(parseRun).filter((r): r is DailyRun => r !== null)
  const counted = countedRuns([...runs, run], block, null)
  if (counted.get(run.author)?.event.id !== event.id) return null
  const mine = counted.get(me)
  if (!mine || mine.score >= run.score) return null
  return { id: `beaten:${event.id}`, kind: 'beaten', day: run.day, at: run.createdAt, actor: run.author, score: run.score }
}
