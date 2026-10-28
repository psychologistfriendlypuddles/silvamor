import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { buildRun, confirmedStreak, countedRuns, nextStreak, parseRun, previousDay, replayRun, verifyRun } from './dailyRuns'
import { dailyDealRules, type DailyDealMove } from '../../games/dailydeal/rules'
import { dayStart, seedFor } from '../../games/dailydeal/daily'

const day = '2026-10-27'
const block = { height: 900_000, hash: 'ab'.repeat(32), timestamp: dayStart(day) + 300 }

/** A full run that plays the first card of the hand every time. */
function playThrough(): { moves: DailyDealMove[]; score: number } {
  const rules = dailyDealRules(seedFor(day, block.hash))
  let state = rules.init()
  const moves: DailyDealMove[] = []
  while (!rules.outcome(state)) {
    const move = { play: [state.hand[0]] }
    state = rules.apply(state, move)
    moves.push(move)
  }
  return { moves, score: state.score }
}

function runEvent(opts: { score?: number; at?: number; sk?: Uint8Array; hash?: string; streak?: number } = {}) {
  const { moves, score } = playThrough()
  const template = buildRun({ day, block: { ...block, hash: opts.hash ?? block.hash }, moves, score: opts.score ?? score, streak: opts.streak ?? 1, beaten: [] })
  template.created_at = opts.at ?? block.timestamp + 60
  return parseRun(finalizeEvent(template, opts.sk ?? generateSecretKey()))!
}

describe('daily runs', () => {
  it('round-trips through an event and verifies', () => {
    const run = runEvent()
    expect(run.day).toBe(day)
    expect(run.block).toEqual({ height: block.height, hash: block.hash })
    expect(verifyRun(run, block, null)).toBe(true)
  })

  it('seeds a different deal from a different block', () => {
    const { moves } = playThrough()
    expect(replayRun(day, 'cd'.repeat(32), moves)?.score).not.toBe(playThrough().score)
  })

  it('rejects a wrong score, another block, or a run outside the day', () => {
    const { score } = playThrough()
    expect(verifyRun(runEvent({ score: score + 1 }), block, null)).toBe(false)
    expect(verifyRun(runEvent({ hash: 'cd'.repeat(32) }), block, null)).toBe(false)
    expect(verifyRun(runEvent({ at: dayStart(day) - 1 }), block, null)).toBe(false)
    const closesAt = dayStart(day) + 86400 + 200
    expect(verifyRun(runEvent({ at: closesAt - 1 }), block, closesAt)).toBe(true)
    expect(verifyRun(runEvent({ at: closesAt }), block, closesAt)).toBe(false)
  })

  it('rejects an unfinished run', () => {
    const { moves } = playThrough()
    expect(replayRun(day, block.hash, moves.slice(0, -1))).toBeNull()
  })

  it("counts each player's earliest valid run", () => {
    const sk = generateSecretKey()
    const early = runEvent({ sk, at: block.timestamp + 100 })
    const later = runEvent({ sk, at: block.timestamp + 200 })
    const bogusEarlier = runEvent({ sk, at: block.timestamp + 50, score: 1 })
    const counted = countedRuns([later, bogusEarlier, early], block, null)
    expect(counted.size).toBe(1)
    expect(counted.get(early.author)?.event.id).toBe(early.event.id)
  })
})

describe('streaks', () => {
  it('links each day to the one before', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28')
    expect(previousDay('2027-01-01')).toBe('2026-12-31')
  })

  it("counts a streak only when the day before's run claims one day less", () => {
    const run = runEvent({ streak: 5 })
    expect(run.streak).toBe(5)
    expect(confirmedStreak(run, [4])).toBe(5)
    expect(confirmedStreak(run, [2])).toBe(1)
    expect(confirmedStreak(run, undefined)).toBe(1)
  })

  it('reads runs from before streaks as a first day, and claims one more than the day before', () => {
    const run = runEvent()
    run.event.tags = run.event.tags.filter((t) => t[0] !== 'streak')
    expect(parseRun(run.event)?.streak).toBe(1)
    expect(nextStreak(undefined)).toBe(1)
    expect(nextStreak([1])).toBe(2)
    expect(nextStreak([6, 1])).toBe(7)
  })
})
