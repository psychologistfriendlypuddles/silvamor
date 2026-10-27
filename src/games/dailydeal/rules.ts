import { IllegalMove, type Rules } from '../types'

/**
 * Daily Deal: a one-player card run on a seeded deck (docs/PROTOCOL.md, "Daily Deal").
 * Everyone playing the same seed gets the same deck and perks, so any client can
 * replay a run's moves and check its score.
 */

export const HAND_SIZE = 8
export const HANDS = 4
export const DISCARDS = 3
export const MAX_CARDS = 5
export const PERK_COUNT = 3

/** Cards are 0..51: suit = floor(card / 13), rank = card % 13 with 0 = two … 12 = ace. */
export const SUITS = ['♠', '♥', '♦', '♣'] as const
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const
export const suitOf = (card: number) => Math.floor(card / 13)
export const rankOf = (card: number) => card % 13
export const cardName = (card: number) => RANKS[rankOf(card)] + SUITS[suitOf(card)]

/** Chips a scoring card adds: its face value, 10 for J/Q/K, 11 for an ace. */
export const cardChips = (card: number) => {
  const r = rankOf(card)
  return r <= 8 ? r + 2 : r === 12 ? 11 : 10
}

export type HandType =
  | 'high'
  | 'pair'
  | 'twopair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'fullhouse'
  | 'quads'
  | 'straightflush'

export const HAND_BASE: Record<HandType, { name: string; chips: number; mult: number }> = {
  high: { name: 'High card', chips: 5, mult: 1 },
  pair: { name: 'Pair', chips: 10, mult: 2 },
  twopair: { name: 'Two pair', chips: 20, mult: 2 },
  trips: { name: 'Three of a kind', chips: 30, mult: 3 },
  straight: { name: 'Straight', chips: 30, mult: 4 },
  flush: { name: 'Flush', chips: 35, mult: 4 },
  fullhouse: { name: 'Full house', chips: 40, mult: 4 },
  quads: { name: 'Four of a kind', chips: 60, mult: 7 },
  straightflush: { name: 'Straight flush', chips: 100, mult: 8 },
}

/** The day's perks. Kinds are listed in the order the seed shuffles them. */
export type Perk =
  | { kind: 'suit'; suit: number }
  | { kind: 'faces' }
  | { kind: 'evens' }
  | { kind: 'pairs' }
  | { kind: 'small' }
  | { kind: 'straights' }
  | { kind: 'flushes' }
  | { kind: 'extraHand' }
  | { kind: 'finale' }

export const PERK_KINDS: Perk['kind'][] = ['suit', 'faces', 'evens', 'pairs', 'small', 'straights', 'flushes', 'extraHand', 'finale']

export function perkText(perk: Perk): string {
  switch (perk.kind) {
    case 'suit':
      return `Each scoring ${SUITS[perk.suit]} card: +3 mult`
    case 'faces':
      return 'Each scoring J, Q or K: +20 chips'
    case 'evens':
      return 'Each scoring 2, 4, 6, 8 or 10: +2 mult'
    case 'pairs':
      return 'Pair or two pair: ×3 mult'
    case 'small':
      return 'Play 3 cards or fewer: ×2 mult'
    case 'straights':
      return 'Straights: ×3 mult'
    case 'flushes':
      return 'Flushes: ×3 mult'
    case 'extraHand':
      return 'One extra hand to play'
    case 'finale':
      return 'Your last hand: ×2 mult'
  }
}

export interface Play {
  cards: number[]
  hand: HandType
  /** The cards that make the hand: only these add their chips. */
  scoring: number[]
  chips: number
  mult: number
  points: number
}

export interface DailyDealState {
  perks: Perk[]
  /** Cards still to draw, next one first. */
  deck: number[]
  hand: number[]
  handsLeft: number
  discardsLeft: number
  score: number
  /** The last move, for the UI: a scored play or the cards discarded. */
  last: { play: Play } | { discard: number[] } | null
}

export type DailyDealMove = { play: number[] } | { discard: number[] }

/**
 * sfc32, seeded from a 64-hex-character seed: the eight 32-bit words w0..w7 (big-endian)
 * become a = w0^w4, b = w1^w5, c = w2^w6, d = w3^w7, and the first 15 outputs are dropped.
 */
export function generator(seed: string): () => number {
  const w = Array.from({ length: 8 }, (_, i) => parseInt(seed.slice(i * 8, i * 8 + 8), 16) | 0)
  let a = w[0] ^ w[4]
  let b = w[1] ^ w[5]
  let c = w[2] ^ w[6]
  let d = w[3] ^ w[7]
  const next = () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
  for (let i = 0; i < 15; i++) next()
  return next
}

/** An integer in 0..n-1: floor(u * n / 2^32), exact since u * n < 2^53. */
const below = (rand: () => number, n: number) => Math.floor((rand() * n) / 4294967296)

/** Fisher–Yates from the end: for i = n-1 down to 1, swap i with below(i + 1). */
function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(rand, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** What the cards make, and which of them score. */
export function evaluate(cards: number[]): { hand: HandType; scoring: number[] } {
  const byRank = new Map<number, number[]>()
  for (const c of cards) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c])
  // Biggest group first, higher rank breaking ties.
  const groups = [...byRank.entries()].sort((x, y) => y[1].length - x[1].length || y[0] - x[0]).map(([, g]) => g)
  const sizes = groups.map((g) => g.length)
  const ranks = [...byRank.keys()].sort((x, y) => x - y)
  const five = cards.length === 5
  const flush = five && cards.every((c) => suitOf(c) === suitOf(cards[0]))
  const straight =
    five && ranks.length === 5 && (ranks[4] - ranks[0] === 4 || ranks.join() === '0,1,2,3,12')

  if (straight && flush) return { hand: 'straightflush', scoring: cards }
  if (sizes[0] === 4) return { hand: 'quads', scoring: groups[0] }
  if (sizes[0] === 3 && sizes[1] === 2) return { hand: 'fullhouse', scoring: cards }
  if (flush) return { hand: 'flush', scoring: cards }
  if (straight) return { hand: 'straight', scoring: cards }
  if (sizes[0] === 3) return { hand: 'trips', scoring: groups[0] }
  if (sizes[0] === 2 && sizes[1] === 2) return { hand: 'twopair', scoring: [...groups[0], ...groups[1]] }
  if (sizes[0] === 2) return { hand: 'pair', scoring: groups[0] }
  return { hand: 'high', scoring: groups[0] }
}

/** Scores a play: base chips and mult, scoring cards' chips, adding perks, then multiplying perks. */
export function scorePlay(cards: number[], perks: Perk[], lastHand: boolean): Play {
  const { hand, scoring } = evaluate(cards)
  let chips = HAND_BASE[hand].chips + scoring.reduce((sum, c) => sum + cardChips(c), 0)
  let mult = HAND_BASE[hand].mult
  for (const perk of perks) {
    for (const c of scoring) {
      if (perk.kind === 'suit' && suitOf(c) === perk.suit) mult += 3
      if (perk.kind === 'faces' && rankOf(c) >= 9 && rankOf(c) <= 11) chips += 20
      if (perk.kind === 'evens' && rankOf(c) <= 8 && rankOf(c) % 2 === 0) mult += 2
    }
  }
  for (const perk of perks) {
    if (perk.kind === 'pairs' && (hand === 'pair' || hand === 'twopair')) mult *= 3
    if (perk.kind === 'small' && cards.length <= 3) mult *= 2
    if (perk.kind === 'straights' && (hand === 'straight' || hand === 'straightflush')) mult *= 3
    if (perk.kind === 'flushes' && (hand === 'flush' || hand === 'straightflush')) mult *= 3
    if (perk.kind === 'finale' && lastHand) mult *= 2
  }
  return { cards, hand, scoring, chips, mult, points: chips * mult }
}

/** The day's deal: perks first, then the deck, both drawn from one generator. */
export function deal(seed: string): DailyDealState {
  const rand = generator(seed)
  const perks = shuffle(PERK_KINDS, rand)
    .slice(0, PERK_COUNT)
    .map((kind): Perk => (kind === 'suit' ? { kind, suit: below(rand, 4) } : { kind }))
  const cards = shuffle(
    Array.from({ length: 52 }, (_, i) => i),
    rand,
  )
  return {
    perks,
    deck: cards.slice(HAND_SIZE),
    hand: cards.slice(0, HAND_SIZE),
    handsLeft: HANDS + (perks.some((p) => p.kind === 'extraHand') ? 1 : 0),
    discardsLeft: DISCARDS,
    score: 0,
    last: null,
  }
}

/** Takes cards out of the hand and draws back up to HAND_SIZE. */
function replace(state: DailyDealState, cards: number[]): Pick<DailyDealState, 'hand' | 'deck'> {
  const kept = state.hand.filter((c) => !cards.includes(c))
  const drawn = state.deck.slice(0, HAND_SIZE - kept.length)
  return { hand: [...kept, ...drawn], deck: state.deck.slice(drawn.length) }
}

const SEED = /^[0-9a-f]{64}$/

/** The rules for a run on this seed (64 lowercase hex characters). */
export function dailyDealRules(seed: string): Rules<DailyDealState, DailyDealMove> {
  if (!SEED.test(seed)) throw new Error('A seed is 64 lowercase hex characters.')
  return {
    init: () => deal(seed),

    apply(state, move) {
      if (this.outcome(state)) throw new IllegalMove('The run is over.')
      const cards = 'play' in move ? move.play : move.discard
      if (cards.length < 1 || cards.length > MAX_CARDS) throw new IllegalMove(`Pick 1 to ${MAX_CARDS} cards.`)
      if (new Set(cards).size !== cards.length) throw new IllegalMove('A card is listed twice.')
      if (!cards.every((c) => state.hand.includes(c))) throw new IllegalMove('That card is not in your hand.')
      if ('discard' in move) {
        if (state.discardsLeft === 0) throw new IllegalMove('No discards left.')
        return { ...state, ...replace(state, cards), discardsLeft: state.discardsLeft - 1, last: { discard: cards } }
      }
      const play = scorePlay(cards, state.perks, state.handsLeft === 1)
      return {
        ...state,
        ...replace(state, cards),
        handsLeft: state.handsLeft - 1,
        score: state.score + play.points,
        last: { play },
      }
    },

    outcome: (state) => (state.handsLeft === 0 ? { score: state.score } : null),

    parseMove(raw) {
      const r = raw as { play?: unknown; discard?: unknown } | null
      const cards = r?.play ?? r?.discard
      if (
        (r?.play === undefined) === (r?.discard === undefined) ||
        !Array.isArray(cards) ||
        cards.length < 1 ||
        cards.length > MAX_CARDS ||
        !cards.every((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < 52) ||
        new Set(cards).size !== cards.length
      ) {
        throw new IllegalMove('Bad move format.')
      }
      return r!.play !== undefined ? { play: cards as number[] } : { discard: cards as number[] }
    },
  }
}
