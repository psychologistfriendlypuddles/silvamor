import type { Outcome } from '../games/types'

export interface FinishedGame {
  coordinate: string
  players: string[]
  outcome: Outcome
}

export interface PlayerRecord {
  /** Distinct people this player has finished games with. */
  opponents: number
  /** Head-to-head results: each opponent counts once (see docs/PROTOCOL.md, "Ratings"). */
  wins: number
  losses: number
  draws: number
  /** Raw number of finished games, for display only. */
  games: number
  /** Games this player lost by letting the turn clock run out. */
  abandoned: number
  /** 0..1: share of games finished properly, averaged per opponent. Null with no games. */
  reliability: number | null
}

/**
 * Computes a player's record from finished games anyone can replay.
 *
 * Unique-opponent rule: results are first grouped per opponent, so playing the
 * same friend a hundred times moves the record exactly as much as playing them once.
 */
export function computeRecord(pubkey: string, games: FinishedGame[]): PlayerRecord {
  const perOpponent = new Map<string, { net: number; games: number; abandoned: number }>()
  let abandoned = 0
  let total = 0

  for (const game of games) {
    const me = game.players.indexOf(pubkey)
    if (me < 0) continue
    total++
    const o = game.outcome
    const net = 'draw' in o ? 0 : o.winner === me ? 1 : -1
    const iAbandoned = !('draw' in o) && o.reason === 'strikes' && o.winner !== me
    if (iAbandoned) abandoned++

    for (const opponent of game.players) {
      if (opponent === pubkey) continue
      const entry = perOpponent.get(opponent) ?? { net: 0, games: 0, abandoned: 0 }
      entry.net += net
      entry.games += 1
      if (iAbandoned) entry.abandoned += 1
      perOpponent.set(opponent, entry)
    }
  }

  const entries = [...perOpponent.values()]
  return {
    opponents: entries.length,
    wins: entries.filter((e) => e.net > 0).length,
    losses: entries.filter((e) => e.net < 0).length,
    draws: entries.filter((e) => e.net === 0).length,
    games: total,
    abandoned,
    reliability: entries.length
      ? entries.reduce((sum, e) => sum + (e.games - e.abandoned) / e.games, 0) / entries.length
      : null,
  }
}
