import { describe, expect, it } from 'vitest'
import { bestFees, dealFrom, decodeMoves, encodeMoves, minerFees, minerRules, minerSeed, pageStarts, percentOf, STREAM_LENGTH, type BlockTx, type MinerDeal } from './rules'
import { IllegalMove } from '../types'

const seed = minerSeed('2026-10-28', 'ab'.repeat(32))
const hex = (n: number) => n.toString(16).padStart(64, '0')

/** Pages of made-up transactions: tx n pays n * 37 % 400 + 100 sats for 150 + n % 7 * 40 vbytes; every tenth spends from the one before. */
function pages(): BlockTx[][] {
  return [0, 1, 2, 3].map((p) =>
    Array.from({ length: 25 }, (_, i) => {
      const n = p * 25 + i
      return { txid: hex(n + 1), fee: ((n * 37) % 400) + 100, weight: (150 + (n % 7) * 40) * 4, inputs: n % 10 === 9 ? [hex(n)] : [hex(5000 + n)], coinbase: n === 0 }
    }),
  )
}

describe('beat the miner: the deal', () => {
  const deal = dealFrom(seed, pages())

  it('reads one page from each quarter of the block', () => {
    const starts = pageStarts(seed, 4000)
    expect(starts).toHaveLength(4)
    starts.forEach((s, i) => {
      expect(s % 25).toBe(0)
      expect(s).toBeGreaterThanOrEqual(Math.floor((i * 999) / 25) * 25)
      expect(s).toBeLessThan((i + 1) * 1000)
    })
  })

  it('streams up to 30 real transactions, children after their parent, without the coinbase', () => {
    expect(deal.stream.length).toBe(STREAM_LENGTH)
    expect(deal.stream.some((t) => t.txid === hex(1))).toBe(false)
    const kids = deal.stream.map((t, i) => [t, i] as const).filter(([t]) => t.parent !== undefined)
    expect(kids.length).toBeGreaterThan(0)
    for (const [t, i] of kids) expect(t.parent!).toBeLessThan(i)
    expect(deal.foundAt).toBeGreaterThanOrEqual(18)
    expect(deal.foundAt).toBeLessThanOrEqual(30)
  })

  it('is the same deal for the same seed, and another for another', () => {
    expect(dealFrom(seed, pages())).toEqual(deal)
    expect(dealFrom(minerSeed('2026-10-29', 'ab'.repeat(32)), pages())).not.toEqual(deal)
  })
})

describe('beat the miner: playing', () => {
  /** Three transactions; the block is found after all three, with room for 300 vbytes. */
  const deal: MinerDeal = {
    stream: [
      { txid: hex(1), fee: 100, vsize: 200 },
      { txid: hex(2), fee: 900, vsize: 100, parent: 0 },
      { txid: hex(3), fee: 500, vsize: 150 },
    ],
    capacity: 300,
    foundAt: 3,
  }
  const rules = minerRules(deal)
  const play = (moves: ('take' | 'pass')[]) => moves.reduce((s, m) => rules.apply(s, m), rules.init())

  it('scores the fees taken once the block is found', () => {
    const state = play(['take', 'take', 'pass'])
    expect(rules.outcome(state)).toEqual({ score: 1000 })
    expect(() => rules.apply(state, 'pass')).toThrow(IllegalMove)
  })

  it("refuses a child without its parent, and what doesn't fit", () => {
    expect(() => play(['pass', 'take'])).toThrow(/parent/)
    expect(() => play(['take', 'take', 'take'])).toThrow(/fit/)
  })

  it('knows the best block in hindsight, and the miner', () => {
    expect(bestFees(deal)).toBe(1000)
    // A cheap parent worth taking for its rich child: the miner, going by fee rate, passes on it
    // and so can't have the child.
    const trap: MinerDeal = {
      stream: [
        { txid: hex(1), fee: 300, vsize: 100 },
        { txid: hex(2), fee: 100, vsize: 200 },
        { txid: hex(3), fee: 900, vsize: 100, parent: 1 },
      ],
      capacity: 300,
      foundAt: 3,
    }
    expect(minerFees(trap)).toBe(300)
    expect(bestFees(trap)).toBe(1000)
    expect(percentOf(1000, 300)).toBe(333)
  })

  it('stores moves as one letter each', () => {
    expect(encodeMoves(['take', 'pass'])).toBe('tp')
    expect(decodeMoves('tp')).toEqual(['take', 'pass'])
  })
})
