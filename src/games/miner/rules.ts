import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { IllegalMove, type Rules } from '../types'
import { generator } from '../random'
import type { TxFacts } from './facts'

// Block of the Day (docs/PROTOCOL.md, "Block of the Day"): real transactions from the day's seed block
// arrive one at a time; take each into your block or pass on it for good, until the block is
// found at a moment you don't know. Fill it with more fees than the miner.

/** How many transactions arrive, at most. */
export const STREAM_LENGTH = 30
/** The block is found after at least this many arrivals (and at most STREAM_LENGTH). */
export const EARLIEST_FIND = 18
/** Your block has room for this share of the whole stream's size. */
export const ROOM = 0.45
/** Transactions bigger than this (vbytes) are left out, so no single one decides the day. */
export const MAX_VSIZE = 1500
/** Pages of 25 transactions read from the seed block, spread from its start (high fees) to its end. */
export const PAGES = 4
export const PAGE_SIZE = 25
/** A parent brings at most this many of its children into the stream. */
const MAX_CHILDREN = 2

/** A transaction as the block sources list it (Esplora `/block/:hash/txs/:start`). */
export interface BlockTx {
  txid: string
  fee: number
  weight: number
  /** The transactions it spends from. */
  inputs: string[]
  coinbase: boolean
  /** For show only (what the sprite says about it); not part of the game. */
  facts?: TxFacts
}

export interface Tx {
  txid: string
  /** Sats. */
  fee: number
  vsize: number
  /** The stream position of the transaction it spends from, when that one is in the stream too: it has to be in your block first. */
  parent?: number
  facts?: TxFacts
}

/** The day's deal: the stream, your block's room, and how many transactions arrive before the block is found. */
export interface MinerDeal {
  stream: Tx[]
  capacity: number
  foundAt: number
}

export interface MinerState {
  /** Stream position of the transaction on offer. */
  next: number
  /** Stream positions in your block. */
  taken: number[]
  used: number
  fees: number
  /** The block has been found: the run is over. */
  found: boolean
}

export type MinerMove = 'take' | 'pass'

/** The day's seed: sha256 of "silvamor/miner/<YYYY-MM-DD>/<seed block hash>". */
export const minerSeed = (day: string, blockHash: string) => bytesToHex(sha256(new TextEncoder().encode(`silvamor/miner/${day}/${blockHash}`)))

const below = (rand: () => number, n: number) => Math.floor((rand() * n) / 4294967296)

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(rand, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Where the pages read from the block start: one in each quarter of the block (after the
 * coinbase), at a seeded place, rounded down to a page.
 */
export function pageStarts(seed: string, txCount: number): number[] {
  const rand = generator(seed)
  const span = Math.max(1, Math.floor((txCount - 1) / PAGES))
  const starts = Array.from({ length: PAGES }, (_, i) => Math.floor((1 + i * span + below(rand, span)) / PAGE_SIZE) * PAGE_SIZE)
  return [...new Set(starts.filter((s) => s < txCount))]
}

/**
 * The day's deal from the pages read. Transactions spending from another one on the pages are its
 * children; deeper chains and transactions with two such parents are left out. Children arrive
 * after their parent.
 */
export function dealFrom(seed: string, pages: BlockTx[][]): MinerDeal {
  const rand = generator(seed)
  // Skip the first outputs, which pageStarts used.
  for (let i = 0; i < PAGES; i++) rand()
  const seen = new Map<string, BlockTx>()
  for (const tx of pages.flat()) if (!tx.coinbase && Math.ceil(tx.weight / 4) <= MAX_VSIZE && tx.fee >= 0) seen.set(tx.txid, tx)
  const parentsOf = (tx: BlockTx) => [...new Set(tx.inputs.filter((id) => seen.has(id)))]
  const roots = [...seen.values()].filter((tx) => parentsOf(tx).length === 0).sort((a, b) => (a.txid < b.txid ? -1 : 1))
  const children = new Map<string, BlockTx[]>()
  for (const tx of seen.values()) {
    const parents = parentsOf(tx)
    if (parents.length !== 1 || parentsOf(seen.get(parents[0])!).length > 0) continue
    children.set(parents[0], [...(children.get(parents[0]) ?? []), tx].sort((a, b) => (a.txid < b.txid ? -1 : 1)).slice(0, MAX_CHILDREN))
  }

  // Pick roots (each with its children) until the stream is full, then order: shuffled, children after their parent.
  const picked: BlockTx[] = []
  for (const root of shuffle(roots, rand)) {
    const family = [root, ...(children.get(root.txid) ?? [])]
    if (picked.length + family.length > STREAM_LENGTH) continue
    picked.push(...family)
    if (picked.length === STREAM_LENGTH) break
  }
  const order = shuffle(picked, rand)
  const parentOf = new Map([...children].flatMap(([parent, kids]) => kids.map((k) => [k.txid, parent] as const)))
  // Move each child just after its parent when it would arrive first.
  for (let i = 0; i < order.length; i++) {
    const parent = parentOf.get(order[i].txid)
    const at = parent ? order.findIndex((t) => t.txid === parent) : -1
    if (at > i) {
      const [child] = order.splice(i, 1)
      order.splice(at, 0, child)
      i--
    }
  }
  const position = new Map(order.map((t, i) => [t.txid, i]))
  const stream: Tx[] = order.map((t) => {
    const parent = parentOf.get(t.txid)
    return {
      txid: t.txid,
      fee: t.fee,
      vsize: Math.ceil(t.weight / 4),
      ...(parent !== undefined && position.has(parent) ? { parent: position.get(parent) } : {}),
      ...(t.facts && { facts: t.facts }),
    }
  })
  const total = stream.reduce((sum, t) => sum + t.vsize, 0)
  const earliest = Math.min(EARLIEST_FIND, stream.length)
  return { stream, capacity: Math.round(total * ROOM), foundAt: earliest + below(rand, stream.length - earliest + 1) }
}

/** Why `tx` can't go in your block now, or null if it can. */
export function blocked(deal: MinerDeal, state: MinerState, at: number): 'full' | 'parent' | null {
  const tx = deal.stream[at]
  if (tx.parent !== undefined && !state.taken.includes(tx.parent)) return 'parent'
  if (state.used + tx.vsize > deal.capacity) return 'full'
  return null
}

export function minerRules(deal: MinerDeal): Rules<MinerState, MinerMove> {
  return {
    init: () => ({ next: 0, taken: [], used: 0, fees: 0, found: deal.foundAt === 0 }),
    apply(state, move) {
      if (state.found) throw new IllegalMove('The block has been found.')
      const at = state.next
      const tx = deal.stream[at]
      let next = { ...state, next: at + 1 }
      if (move === 'take') {
        const why = blocked(deal, state, at)
        if (why === 'parent') throw new IllegalMove('Its parent isn’t in your block.')
        if (why === 'full') throw new IllegalMove('It doesn’t fit in your block.')
        next = { ...next, taken: [...state.taken, at], used: state.used + tx.vsize, fees: state.fees + tx.fee }
      }
      return { ...next, found: next.next >= deal.foundAt }
    },
    outcome: (state) => (state.found ? { score: state.fees } : null),
    parseMove(raw) {
      if (raw !== 'take' && raw !== 'pass') throw new IllegalMove('A move is take or pass.')
      return raw
    },
  }
}

/** Moves as stored in a run: "t" and "p", one letter each. */
export const encodeMoves = (moves: MinerMove[]) => moves.map((m) => (m === 'take' ? 't' : 'p')).join('')
export const decodeMoves = (text: string): unknown[] => [...text].map((c) => (c === 't' ? 'take' : c === 'p' ? 'pass' : c))

/**
 * The miner: real mining software ranks by fee rate, so it takes whatever pays at least the average
 * fee rate seen so far (this one included), if it fits and its parent is in. Its moves, one per
 * transaction until the block is found.
 */
export function minerMoves(deal: MinerDeal): MinerMove[] {
  const rules = minerRules(deal)
  let state = rules.init()
  let fee = 0
  let vsize = 0
  const moves: MinerMove[] = []
  while (!state.found) {
    const tx = deal.stream[state.next]
    fee += tx.fee
    vsize += tx.vsize
    const move = tx.fee / tx.vsize >= fee / vsize && blocked(deal, state, state.next) === null ? 'take' : 'pass'
    state = rules.apply(state, move)
    moves.push(move)
  }
  return moves
}

/** The miner's fees after the first `arrived` transactions (all of them by default). */
export function minerFees(deal: MinerDeal, arrived = deal.foundAt): number {
  return minerMoves(deal)
    .slice(0, arrived)
    .reduce((sum, m, i) => sum + (m === 'take' ? deal.stream[i].fee : 0), 0)
}

/**
 * The most fees any block could have held, knowing what arrives before the block is found: a
 * knapsack over each parent with its children (a child only with its parent).
 */
export function bestFees(deal: MinerDeal): number {
  const arrived = deal.stream.slice(0, deal.foundAt)
  const families = arrived.map((tx, i) => ({ tx, i })).filter(({ tx }) => tx.parent === undefined)
  // fees[c]: the most fees in at most c vbytes.
  let fees = new Array<number>(deal.capacity + 1).fill(0)
  for (const { tx, i } of families) {
    const kids = arrived.filter((t) => t.parent === i)
    // Every choice for this family: none, or the parent with any set of its children.
    const options: { vsize: number; fee: number }[] = []
    for (let mask = 0; mask < 1 << kids.length; mask++) {
      const chosen = kids.filter((_, k) => mask & (1 << k))
      options.push({ vsize: tx.vsize + chosen.reduce((s, t) => s + t.vsize, 0), fee: tx.fee + chosen.reduce((s, t) => s + t.fee, 0) })
    }
    const next = [...fees]
    for (const o of options) for (let c = o.vsize; c <= deal.capacity; c++) next[c] = Math.max(next[c], fees[c - o.vsize] + o.fee)
    fees = next
  }
  return fees[deal.capacity]
}

