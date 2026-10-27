import { describe, expect, it } from 'vitest'
import { IllegalMove } from '../types'
import {
  DISCARDS,
  HANDS,
  HAND_SIZE,
  dailyDealRules,
  deal,
  evaluate,
  generator,
  scorePlay,
  type DailyDealState,
} from './rules'

const SEED_A = '00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054'
const SEED_B = '0000000000000000000320283a032748cef8227873ff4872689bf23f1cda83a5'

// Worked out independently (a Python port of the spec in docs/PROTOCOL.md, "Daily Deal").
const GOLDEN_OUTPUTS = [757038052, 659283656, 2882938219]
const GOLDEN_PERKS = [{ kind: 'evens' }, { kind: 'extraHand' }, { kind: 'flushes' }]
const GOLDEN_HAND = [4, 24, 38, 20, 40, 28, 7, 44]

/** Card by name: rank character(s) then suit letter s/h/d/c, e.g. 'Ah', '10s'. */
const c = (name: string) => {
  const rank = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].indexOf(name.slice(0, -1))
  const suit = 'shdc'.indexOf(name.slice(-1))
  if (rank < 0 || suit < 0) throw new Error(`bad card ${name}`)
  return suit * 13 + rank
}
const cards = (names: string) => names.split(' ').map(c)

describe('daily deal: seeding', () => {
  it('is fixed by the seed (a protocol commitment: changing these breaks old runs)', () => {
    const rand = generator(SEED_A)
    expect([rand(), rand(), rand()]).toEqual(GOLDEN_OUTPUTS)
    const s = deal(SEED_A)
    expect(s.perks).toEqual(GOLDEN_PERKS)
    expect(s.hand).toEqual(GOLDEN_HAND)
  })

  it('deals the same for the same seed and differently for another', () => {
    expect(deal(SEED_A)).toEqual(deal(SEED_A))
    expect(deal(SEED_B).hand).not.toEqual(deal(SEED_A).hand)
  })

  it('deals the whole deck once', () => {
    const s = deal(SEED_B)
    expect(s.hand).toHaveLength(HAND_SIZE)
    expect([...s.hand, ...s.deck].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_, i) => i))
  })

  it('picks distinct perks, with an extra hand when that perk comes up', () => {
    for (let i = 0; i < 50; i++) {
      const s = deal(i.toString(16).padStart(64, '7'))
      expect(new Set(s.perks.map((p) => p.kind)).size).toBe(3)
      expect(s.handsLeft).toBe(HANDS + (s.perks.some((p) => p.kind === 'extraHand') ? 1 : 0))
    }
  })
})

describe('daily deal: hands', () => {
  it.each([
    ['Ah', 'high', 'Ah'],
    ['2s Kd 9h', 'high', 'Kd'],
    ['9s 9h 4d', 'pair', '9s 9h'],
    ['9s 9h 4d 4c Ks', 'twopair', '9s 9h 4d 4c'],
    ['7s 7h 7d 2c', 'trips', '7s 7h 7d'],
    ['5s 6h 7d 8c 9s', 'straight', '5s 6h 7d 8c 9s'],
    ['As 2h 3d 4c 5s', 'straight', 'As 2h 3d 4c 5s'],
    ['10s Jh Qd Kc As', 'straight', '10s Jh Qd Kc As'],
    ['2h 7h 9h Jh Kh', 'flush', '2h 7h 9h Jh Kh'],
    ['Qs Qh Qd 3c 3s', 'fullhouse', 'Qs Qh Qd 3c 3s'],
    ['8s 8h 8d 8c 2s', 'quads', '8s 8h 8d 8c'],
    ['5d 6d 7d 8d 9d', 'straightflush', '5d 6d 7d 8d 9d'],
  ])('%s is %s', (played, hand, scoring) => {
    const result = evaluate(cards(played))
    expect(result.hand).toBe(hand)
    expect([...result.scoring].sort()).toEqual(cards(scoring).sort())
  })

  it('does not wrap straights round the ace', () => {
    expect(evaluate(cards('Qs Kh Ad 2c 3s')).hand).toBe('high')
  })

  it('needs five cards for a straight or a flush', () => {
    expect(evaluate(cards('2h 7h 9h Jh')).hand).toBe('high')
  })
})

describe('daily deal: scoring', () => {
  it('adds the scoring cards to the base chips', () => {
    // Pair of kings: 10 + 10 + 10 chips, ×2. The 4 does not score.
    expect(scorePlay(cards('Ks Kh 4d'), [], false)).toMatchObject({ chips: 30, mult: 2, points: 60 })
    // Ace high: 5 + 11 chips, ×1.
    expect(scorePlay(cards('Ah'), [], false).points).toBe(16)
  })

  it('applies adding perks before multiplying ones', () => {
    // Pair of hearts-and-spades eights: 10 + 16 chips; mult (2 + 3 for the heart + 2 + 2 for evens) × 3 for pairs.
    const play = scorePlay(cards('8h 8s'), [{ kind: 'suit', suit: 1 }, { kind: 'evens' }, { kind: 'pairs' }], false)
    expect(play).toMatchObject({ chips: 26, mult: 27, points: 702 })
  })

  it('counts face chips only for J, Q and K', () => {
    expect(scorePlay(cards('Js Qh Kd As 10c'), [{ kind: 'faces' }], false).chips).toBe(30 + 10 + 10 + 10 + 11 + 10 + 60)
  })

  it('doubles small plays and the last hand', () => {
    expect(scorePlay(cards('As Ah Ad'), [{ kind: 'small' }], false).mult).toBe(6)
    expect(scorePlay(cards('As Ah Ad 2c'), [{ kind: 'small' }], false).mult).toBe(3)
    expect(scorePlay(cards('Ah'), [{ kind: 'finale' }], true).mult).toBe(2)
    expect(scorePlay(cards('Ah'), [{ kind: 'finale' }], false).mult).toBe(1)
  })

  it('triples straight flushes for both straights and flushes', () => {
    expect(scorePlay(cards('5d 6d 7d 8d 9d'), [{ kind: 'straights' }, { kind: 'flushes' }], false).mult).toBe(72)
  })
})

describe('daily deal: a run', () => {
  const rules = dailyDealRules(SEED_A)
  /** A deal with no perks, so scores are easy to check. */
  const plain = (): DailyDealState => ({ ...rules.init(), perks: [], handsLeft: HANDS })

  it('plays, discards and refills the hand', () => {
    let s = plain()
    const before = s.deck.length
    s = rules.apply(s, { discard: s.hand.slice(0, 3) })
    expect(s.discardsLeft).toBe(DISCARDS - 1)
    expect(s.hand).toHaveLength(HAND_SIZE)
    expect(s.deck).toHaveLength(before - 3)
    const played = s.hand.slice(0, 2)
    const points = scorePlay(played, [], false).points
    s = rules.apply(s, { play: played })
    expect(s.score).toBe(points)
    expect(s.handsLeft).toBe(HANDS - 1)
    expect(s.hand.some((x) => played.includes(x))).toBe(false)
  })

  it('ends after the last hand', () => {
    let s = plain()
    for (let i = 0; i < HANDS; i++) {
      expect(rules.outcome(s)).toBeNull()
      s = rules.apply(s, { play: [s.hand[0]] })
    }
    expect(rules.outcome(s)).toEqual({ score: s.score })
    expect(() => rules.apply(s, { play: [s.hand[0]] })).toThrow(IllegalMove)
  })

  it('rejects cards not in hand, bad counts, duplicates and spent discards', () => {
    let s = plain()
    const missing = s.deck[0]
    expect(() => rules.apply(s, { play: [missing] })).toThrow(IllegalMove)
    expect(() => rules.apply(s, { play: s.hand.slice(0, 6) })).toThrow(IllegalMove)
    expect(() => rules.apply(s, { play: [] })).toThrow(IllegalMove)
    expect(() => rules.apply(s, { play: [s.hand[0], s.hand[0]] })).toThrow(IllegalMove)
    for (let i = 0; i < DISCARDS; i++) s = rules.apply(s, { discard: [s.hand[0]] })
    expect(() => rules.apply(s, { discard: [s.hand[0]] })).toThrow(IllegalMove)
  })

  it('parses only well-formed moves', () => {
    expect(rules.parseMove({ play: [1, 2] })).toEqual({ play: [1, 2] })
    expect(rules.parseMove({ discard: [51] })).toEqual({ discard: [51] })
    for (const bad of [null, {}, { play: [] }, { play: [52] }, { play: [1.5] }, { play: [1, 1] }, { play: [1, 2, 3, 4, 5, 6] }, { play: [1], discard: [2] }, { play: '1' }]) {
      expect(() => rules.parseMove(bad)).toThrow(IllegalMove)
    }
  })

  it('takes only a 64-hex-character seed', () => {
    expect(() => dailyDealRules('abc')).toThrow()
    expect(() => dailyDealRules(SEED_A.toUpperCase())).toThrow()
    expect(dailyDealRules(SEED_B).init()).toEqual(deal(SEED_B))
  })
})
