import { createElement, type ComponentType } from 'react'
import type { Outcome } from './types'
import { Mark, TicTacToeBoard } from './tictactoe/Board'
import { FourInARowBadge, FourInARowBoard } from './fourinarow/Board'
import { DotsAndBoxesBadge, DotsAndBoxesBoard } from './dotsandboxes/Board'
import { ChessBadge, ChessBoard } from './chess/Board'
import { ReversiBadge, ReversiBoard } from './reversi/Board'
import { CheckersBadge, CheckersBoard } from './checkers/Board'
import { GoBoard } from './go/Board'
import { GomokuBoard } from './gomoku/Board'
import { MorrisBadge, MorrisBoard } from './morris/Board'
import { StoneBadge } from './IntersectionBoard'
import { counts } from './reversi/rules'
import { score, type GoState } from './go/rules'
import { ownerOf, type CheckersState } from './checkers/rules'
import { PIECES, onBoard, type MorrisState } from './morris/rules'
import type { ReversiState } from './reversi/rules'
import { Chess } from 'chess.js'
import { drawReason, type ChessState } from './chess/rules'
import type { DotsAndBoxesState } from './dotsandboxes/rules'

export interface BoardProps<S = unknown, M = unknown> {
  state: S
  /** Final result, shown on the board (e.g. a winning line). Null while playing or replaying. */
  outcome: Outcome | null
  /** Index of the local player, or -1 for spectators. */
  me: number
  canMove: boolean
  onMove(move: M): void
}

/** How a game looks: its board, and the badge shown on each player's card. */
export interface GameUI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Board: ComponentType<BoardProps<any, any>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Badge: ComponentType<{ player: number; state: any }>
  /** Optional word on how a game ended by its rules, e.g. "checkmate" or "stalemate". */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outcomeNote?(state: any, outcome: Outcome): string | null
  /** How many pieces or boxes a player has taken so far (sprites cheer each new one). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captures?(state: any, player: number): number
  /** Whether a player's king is in check right now. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inCheck?(state: any, player: number): boolean
}

/** Pieces the opponent has lost (player 0 is White, so it takes lowercase pieces). */
const chessCaptures = (state: ChessState, player: number) => {
  const board = state.fen.split(' ')[0]
  const left = [...board].filter((c) => (player === 0 ? /[pnbrqk]/ : /[PNBRQK]/).test(c)).length
  return 16 - left
}

function TicTacToeBadge({ player }: { player: number }) {
  return createElement(Mark, { player, className: 'size-8' })
}

export const GAME_UI: Record<string, GameUI> = {
  tictactoe: { Board: TicTacToeBoard, Badge: TicTacToeBadge },
  fourinarow: { Board: FourInARowBoard, Badge: FourInARowBadge },
  dotsandboxes: {
    Board: DotsAndBoxesBoard,
    Badge: DotsAndBoxesBadge,
    captures: (state: DotsAndBoxesState, player) => state.boxes.filter((b) => b === player).length,
  },
  chess: {
    Board: ChessBoard,
    Badge: ChessBadge,
    outcomeNote: (state: ChessState, outcome) => ('draw' in outcome ? drawReason(state) : outcome.reason === 'rules' ? 'checkmate' : null),
    captures: chessCaptures,
    inCheck: (state: ChessState, player) => (state.fen.split(' ')[1] === 'w' ? 0 : 1) === player && new Chess(state.fen).inCheck(),
  },
  reversi: {
    Board: ReversiBoard,
    Badge: ReversiBadge,
    outcomeNote: (state: ReversiState) => counts(state.cells).join('–'),
  },
  checkers: {
    Board: CheckersBoard,
    Badge: CheckersBadge,
    captures: (state: CheckersState, player) => 12 - state.board.filter((s) => ownerOf(s) === 1 - player).length,
  },
  go: {
    Board: GoBoard,
    Badge: StoneBadge,
    outcomeNote: (state: GoState) => {
      const { black, white } = score(state)
      return `${Math.abs(black - white)} points`
    },
    captures: (state: GoState, player) => state.captures[player],
  },
  gomoku: { Board: GomokuBoard, Badge: StoneBadge },
  morris: {
    Board: MorrisBoard,
    Badge: MorrisBadge,
    captures: (state: MorrisState, player) => {
      const other = (1 - player) as 0 | 1
      return PIECES - state.inHand[other] - onBoard(state, other)
    },
  },
}
