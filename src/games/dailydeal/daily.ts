import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { findFirstBlockAfter, type Block } from '../../lib/bitcoin'
import type { DailyDealMove } from './rules'

/** The UTC date a run belongs to, as YYYY-MM-DD. */
export const dayOf = (date: Date) => date.toISOString().slice(0, 10)

/** When a day begins: 00:00 UTC, in unix seconds. */
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000

/**
 * The day's seed: sha256 of "silvamor/dailydeal/<YYYY-MM-DD>/<seed block hash>" (docs/PROTOCOL.md,
 * "Daily Deal"). Nobody knows the deck until the block is mined.
 */
export const seedFor = (day: string, blockHash: string) => bytesToHex(sha256(new TextEncoder().encode(`silvamor/dailydeal/${day}/${blockHash}`)))

const blockKey = (day: string) => `dailydeal:block:${day}`

/** The day's seed block: the first one mined at or after 00:00 UTC. Null until it's mined. */
export async function fetchDayBlock(day: string): Promise<Block | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(blockKey(day)) ?? 'null')
    if (saved) return saved as Block
  } catch {
    /* fetch it again */
  }
  const block = await findFirstBlockAfter(dayStart(day))
  if (block) {
    try {
      localStorage.setItem(blockKey(day), JSON.stringify(block))
    } catch {
      /* fetch it again next time */
    }
  }
  return block
}

/** Milliseconds until the next UTC midnight, when a new deal starts. */
export function untilNextDeal(now: Date) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return next - now.getTime()
}

// A run in progress is kept in this browser only, as its moves, so a reload picks it up again.
const key = (seed: string) => `dailydeal:${seed}`

export function loadMoves(seed: string): unknown[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key(seed)) ?? '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

export function saveMoves(seed: string, moves: DailyDealMove[]) {
  try {
    localStorage.setItem(key(seed), JSON.stringify(moves))
  } catch {
    // Storage can be full or blocked; the run still plays, it just won't survive a reload.
  }
}
