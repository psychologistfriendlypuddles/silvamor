import { describe, expect, it } from 'vitest'
import { shareText } from './share'
import type { Play } from './rules'

const play = (hand: Play['hand']): Play => ({ cards: [], hand, scoring: [], chips: 0, mult: 0, points: 0 })

describe('shareText', () => {
  it('names the score and the best hand played, not the last', () => {
    expect(shareText('2026-10-27', 4325, [play('pair'), play('fullhouse'), play('flush')], 'https://www.silvamor.com')).toBe(
      '🃏 Daily Deal 2026-10-27: 4,325 points\nBest hand: Full house\nSame cards for everyone today. Can you beat me?\nhttps://www.silvamor.com',
    )
  })
})
