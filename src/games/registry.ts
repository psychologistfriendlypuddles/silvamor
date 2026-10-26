import type { AnyRules } from './types'
import { ticTacToe } from './tictactoe/rules'
import { fourInARow } from './fourinarow/rules'
import { dotsAndBoxes } from './dotsandboxes/rules'
import { chess } from './chess/rules'
import { reversi } from './reversi/rules'
import { checkers } from './checkers/rules'
import { go } from './go/rules'
import { gomoku } from './gomoku/rules'
import { morris } from './morris/rules'

export const GAMES: Record<string, AnyRules> = {
  [ticTacToe.id]: ticTacToe,
  [fourInARow.id]: fourInARow,
  [dotsAndBoxes.id]: dotsAndBoxes,
  [chess.id]: chess,
  [reversi.id]: reversi,
  [checkers.id]: checkers,
  [go.id]: go,
  [gomoku.id]: gomoku,
  [morris.id]: morris,
}

/**
 * Shown in the lobby before their rules exist. Use generic game names only,
 * never trademarked titles.
 */
export const UPCOMING: { name: string; emoji: string }[] = []

export function getRules(id: string): AnyRules | undefined {
  return GAMES[id]
}

/** Rules for a specific game listing, applying its options (e.g. board size). */
export function rulesFor(id: string, options: Record<string, string> = {}): AnyRules | undefined {
  const base = GAMES[id]
  if (!base?.configure) return base
  return base.configure(options) ?? undefined
}
