import type { Event, EventTemplate } from 'nostr-tools/pure'
import type { Block } from '../bitcoin'
import { dayStart } from '../../games/dailydeal/daily'
import { decodeMoves, encodeMoves, minerRules, type MinerDeal, type MinerMove, type MinerState } from '../../games/miner/rules'

// See docs/PROTOCOL.md, "Beat the Miner".
export const MINER_RUN_KIND = 1953
/** NIP-32 label namespace: runs are labelled with their day so relays can filter on it. */
export const MINER_LABEL = 'silvamor/miner'

export interface MinerRun {
  event: Event
  author: string
  day: string
  block: { height: number; hash: string }
  /** "t" (take) and "p" (pass), one per transaction offered. */
  moves: string
  /** The fees the run claims (sats); `verifyMinerRun` checks it. */
  score: number
  createdAt: number
}

const tag = (event: Event, name: string) => event.tags.find((t) => t[0] === name)

export function buildMinerRun(f: { day: string; block: Block; moves: MinerMove[]; score: number }): EventTemplate {
  return {
    kind: MINER_RUN_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify({ moves: encodeMoves(f.moves) }),
    tags: [
      ['L', MINER_LABEL],
      ['l', f.day, MINER_LABEL],
      ['block', String(f.block.height), f.block.hash],
      ['score', String(f.score)],
      ['alt', `Beat the Miner on Silvamor: ${f.score} sats in fees`],
    ],
  }
}

export function parseMinerRun(event: Event): MinerRun | null {
  const label = event.tags.find((t) => t[0] === 'l' && t[2] === MINER_LABEL)?.[1]
  const block = tag(event, 'block')
  const height = Number(block?.[1])
  const score = Number(tag(event, 'score')?.[1])
  if (event.kind !== MINER_RUN_KIND || !label || !/^\d{4}-\d{2}-\d{2}$/.test(label)) return null
  if (!Number.isSafeInteger(height) || !/^[0-9a-f]{64}$/.test(block?.[2] ?? '') || !Number.isSafeInteger(score)) return null
  let moves: unknown
  try {
    moves = JSON.parse(event.content).moves
  } catch {
    return null
  }
  if (typeof moves !== 'string' || !/^[tp]{0,64}$/.test(moves)) return null
  return { event, author: event.pubkey, day: label, block: { height, hash: block![2] }, moves, score, createdAt: event.created_at }
}

/** Replays a run's moves on the deal; the finished state, or null if they aren't a legal, complete run. */
export function replayMinerRun(deal: MinerDeal, moves: string): MinerState | null {
  const rules = minerRules(deal)
  try {
    const state = decodeMoves(moves).reduce<MinerState>((s, raw) => rules.apply(s, rules.parseMove(raw)), rules.init())
    return rules.outcome(state) ? state : null
  } catch {
    return null
  }
}

/**
 * Whether a run counts for the day `block` seeds: made on that block, after the day began and
 * before the next day's seed block (`closesAt`, once known), and its moves replay on the day's
 * deal to the fees it claims.
 */
export function verifyMinerRun(run: MinerRun, block: Block, deal: MinerDeal, closesAt: number | null): boolean {
  if (run.block.height !== block.height || run.block.hash !== block.hash) return false
  if (run.createdAt < dayStart(run.day) || (closesAt !== null && run.createdAt >= closesAt)) return false
  return replayMinerRun(deal, run.moves)?.fees === run.score
}

/** Each player's run that counts: their earliest valid one (the lower id breaks a tie). */
export function countedMinerRuns(runs: MinerRun[], block: Block, deal: MinerDeal, closesAt: number | null): Map<string, MinerRun> {
  const counted = new Map<string, MinerRun>()
  for (const run of runs) {
    if (!verifyMinerRun(run, block, deal, closesAt)) continue
    const other = counted.get(run.author)
    if (!other || run.createdAt < other.createdAt || (run.createdAt === other.createdAt && run.event.id < other.event.id)) counted.set(run.author, run)
  }
  return counted
}
