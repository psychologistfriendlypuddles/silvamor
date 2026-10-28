import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { dayStart, isDay } from '../../games/day'
import { DAY_GRACE, buildMinerRun, madeOnItsDay, parseMinerRun } from './minerRuns'

const block = { height: 900_000, hash: 'ab'.repeat(32), timestamp: 0 }
/** A run for `day`, made at `at` (unix seconds). */
const runOn = (day: string, at: number) =>
  parseMinerRun(finalizeEvent({ ...buildMinerRun({ day, block, moves: [], score: 0, streak: 1 }), created_at: at }, generateSecretKey()))

describe("a run's day", () => {
  it('is a real date', () => {
    expect(isDay('2026-10-28')).toBe(true)
    expect(isDay('2026-02-31')).toBe(false)
    expect(isDay('2026-13-01')).toBe(false)
    expect(runOn('2026-02-31', dayStart('2026-03-03'))).toBeNull()
  })

  it('is the day it was made on, or just after midnight', () => {
    const start = dayStart('2026-10-28')
    expect(madeOnItsDay(runOn('2026-10-28', start)!)).toBe(true)
    expect(madeOnItsDay(runOn('2026-10-28', start - 1)!)).toBe(false)
    expect(madeOnItsDay(runOn('2026-10-28', start + 86400 + DAY_GRACE - 1)!)).toBe(true)
    expect(madeOnItsDay(runOn('2026-10-28', start + 86400 + DAY_GRACE)!)).toBe(false)
  })
})
