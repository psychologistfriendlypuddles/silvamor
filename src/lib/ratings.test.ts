import { describe, expect, it } from 'vitest'
import { computeRecord, type FinishedGame } from './ratings'

const me = 'a'.repeat(64)
const bob = 'b'.repeat(64)
const carol = 'c'.repeat(64)
let n = 0
const game = (players: string[], outcome: FinishedGame['outcome']): FinishedGame => ({ coordinate: String(n++), players, outcome })

describe('computeRecord', () => {
  it('counts each opponent once, no matter how many games', () => {
    const pumped = Array.from({ length: 50 }, () => game([me, bob], { winner: 0, reason: 'rules' }))
    const r = computeRecord(me, pumped)
    expect(r).toMatchObject({ opponents: 1, wins: 1, losses: 0, games: 50 })
  })

  it('uses the net head-to-head result per opponent', () => {
    const r = computeRecord(me, [
      game([me, bob], { winner: 0 }),
      game([bob, me], { winner: 0 }),
      game([me, bob], { winner: 0 }), // 2-1 vs bob: a win
      game([me, carol], { winner: 1 }), // 0-1 vs carol: a loss
      game([carol, me], { draw: true }),
    ])
    expect(r).toMatchObject({ opponents: 2, wins: 1, losses: 1, draws: 0 })
  })

  it('counts abandonment against the player who timed out only', () => {
    const games = [game([me, bob], { winner: 1, reason: 'strikes' }), game([me, carol], { winner: 0, reason: 'rules' })]
    expect(computeRecord(me, games)).toMatchObject({ abandoned: 1, reliability: 0.5 })
    expect(computeRecord(bob, games)).toMatchObject({ abandoned: 0, reliability: 1 })
  })

  it('stops a friend diluting abandonments by farming finished games', () => {
    const games = [
      game([me, carol], { winner: 1, reason: 'strikes' }),
      ...Array.from({ length: 30 }, () => game([me, bob], { winner: 0 })),
    ]
    // Per-opponent average: carol 0%, bob 100%, so 50%, not 30/31.
    expect(computeRecord(me, games).reliability).toBe(0.5)
  })

  it('treats resigning as finishing properly', () => {
    expect(computeRecord(me, [game([me, bob], { winner: 1, reason: 'resign' })]).reliability).toBe(1)
  })

  it('has no reliability without games', () => {
    expect(computeRecord(me, []).reliability).toBeNull()
  })
})
