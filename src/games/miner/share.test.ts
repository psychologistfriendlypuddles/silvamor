import { describe, expect, it } from 'vitest'
import { shareText, shortSats } from './share'

describe('sharing a block', () => {
  it('writes sats in short, to 3 significant digits', () => {
    const cases: [number, string][] = [
      [1, '1 sat'],
      [9, '9 sats'],
      [154, '154 sats'],
      [999, '999 sats'],
      [1000, '1k sats'],
      [15_340, '15.3k sats'],
      [100_000, '100k sats'],
      [105_200, '105k sats'],
      [999_950, '1m sats'],
      [1_500_000, '1.5m sats'],
    ]
    for (const [n, text] of cases) expect(shortSats(n)).toBe(text)
  })

  it("tells the gap to the miner, not the score", () => {
    expect(shareText('2026-10-28', 921_345, 114_499, 153_808, 5, 'https://www.silvamor.com')).toBe(
      [
        '⛏️ Block of the Day 2026-10-28, block 921,345: 39.3k sats behind the miner',
        '🔥 5-day streak',
        'The miner got me today. Can you beat it?',
        'https://www.silvamor.com #blockoftheday',
      ].join('\n'),
    )
    expect(shareText('2026-10-28', 921_345, 1_001, 1_000, 1, 'u').split('\n').slice(0, 2)).toEqual(['⛏️ Block of the Day 2026-10-28, block 921,345: 1 sat ahead of the miner', 'I beat the miner! Can you?'])
    expect(shareText('2026-10-28', 921_345, 500, 500, 1, 'u').split('\n')[0]).toMatch(/level with the miner$/)
  })
})
