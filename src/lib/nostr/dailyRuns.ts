import type { Event, EventTemplate } from 'nostr-tools/pure'
import type { Block } from '../bitcoin'
import { dailyDealRules, type DailyDealMove, type DailyDealState } from '../../games/dailydeal/rules'
import { dayStart, seedFor } from '../../games/dailydeal/daily'

// See docs/PROTOCOL.md, "Daily Deal".
export const DAILY_RUN_KIND = 1952
/** NIP-32 label namespace: runs are labelled with their day so relays can filter on it. */
export const DAILY_LABEL = 'silvamor/dailydeal'

export interface DailyRun {
  event: Event
  author: string
  day: string
  block: { height: number; hash: string }
  moves: unknown[]
  /** The score the run claims; `verifyRun` checks it. */
  score: number
  createdAt: number
}

const tag = (event: Event, name: string) => event.tags.find((t) => t[0] === name)

export function buildRun(f: { day: string; block: Block; moves: DailyDealMove[]; score: number; beaten: string[] }): EventTemplate {
  return {
    kind: DAILY_RUN_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify({ moves: f.moves }),
    tags: [
      ['L', DAILY_LABEL],
      ['l', f.day, DAILY_LABEL],
      ['block', String(f.block.height), f.block.hash],
      ['score', String(f.score)],
      ...f.beaten.map((p) => ['p', p]),
      ['alt', `Daily Deal run on Silvamor: ${f.score} points`],
    ],
  }
}

export function parseRun(event: Event): DailyRun | null {
  const label = event.tags.find((t) => t[0] === 'l' && t[2] === DAILY_LABEL)?.[1]
  const block = tag(event, 'block')
  const height = Number(block?.[1])
  const score = Number(tag(event, 'score')?.[1])
  if (event.kind !== DAILY_RUN_KIND || !label || !/^\d{4}-\d{2}-\d{2}$/.test(label)) return null
  if (!Number.isSafeInteger(height) || !/^[0-9a-f]{64}$/.test(block?.[2] ?? '') || !Number.isSafeInteger(score)) return null
  let moves: unknown
  try {
    moves = JSON.parse(event.content).moves
  } catch {
    return null
  }
  if (!Array.isArray(moves)) return null
  return { event, author: event.pubkey, day: label, block: { height, hash: block![2] }, moves, score, createdAt: event.created_at }
}

/** Replays a run's moves; the finished state, or null if they aren't a legal, complete run. */
export function replayRun(day: string, blockHash: string, moves: unknown[]): DailyDealState | null {
  const rules = dailyDealRules(seedFor(day, blockHash))
  try {
    const state = moves.reduce<DailyDealState>((s, raw) => rules.apply(s, rules.parseMove(raw)), rules.init())
    return rules.outcome(state) ? state : null
  } catch {
    return null
  }
}

/**
 * Whether a run counts for the day `block` seeds: made on that block, after the day began
 * and before the next day's seed block (`closesAt`, its timestamp, once known), and its
 * moves replay to the score it claims.
 */
export function verifyRun(run: DailyRun, block: Block, closesAt: number | null): boolean {
  if (run.block.height !== block.height || run.block.hash !== block.hash) return false
  if (run.createdAt < dayStart(run.day) || (closesAt !== null && run.createdAt >= closesAt)) return false
  return replayRun(run.day, block.hash, run.moves)?.score === run.score
}

/** Each player's run that counts: their earliest valid one (the lower id breaks a tie). */
export function countedRuns(runs: DailyRun[], block: Block, closesAt: number | null): Map<string, DailyRun> {
  const counted = new Map<string, DailyRun>()
  for (const run of runs) {
    if (!verifyRun(run, block, closesAt)) continue
    const other = counted.get(run.author)
    if (!other || run.createdAt < other.createdAt || (run.createdAt === other.createdAt && run.event.id < other.event.id)) counted.set(run.author, run)
  }
  return counted
}
