import { Chess } from 'chess.js'
import { IllegalMove, type GameRules } from '../types'

export const START_FEN = new Chess().fen()

export type Promotion = 'q' | 'r' | 'b' | 'n'
export interface ChessMove {
  from: string
  to: string
  /** Required when a pawn reaches the last rank. */
  promotion?: Promotion
}

export interface ChessState {
  /** The position (FEN). Player 0 is White, player 1 is Black. */
  fen: string
  /** Every position so far (FEN without the move counters), for threefold repetition. */
  positions: string[]
  /** Squares of the last move, for highlighting. */
  last: { from: string; to: string } | null
}

/** A position for repetition purposes: pieces, side to move, castling rights and en passant square. */
const positionKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

const SQUARE = /^[a-h][1-8]$/

export const chess: GameRules<ChessState, ChessMove> = {
  id: 'chess',
  name: 'Chess',
  emoji: '♟️',
  players: 2,

  init: () => ({ fen: START_FEN, positions: [positionKey(START_FEN)], last: null }),

  turn: (state) => (state.fen.split(' ')[1] === 'w' ? 0 : 1),

  apply(state, move, player) {
    if (this.outcome(state)) throw new IllegalMove('The game is over.')
    if (player !== this.turn(state)) throw new IllegalMove('Not your turn.')
    const game = new Chess(state.fen)
    try {
      game.move({ from: move.from, to: move.to, promotion: move.promotion })
    } catch {
      throw new IllegalMove('Illegal move.')
    }
    const fen = game.fen()
    return { fen, positions: [...state.positions, positionKey(fen)], last: { from: move.from, to: move.to } }
  },

  outcome(state) {
    const game = new Chess(state.fen)
    // Checkmate: the side to move has lost.
    if (game.isCheckmate()) return { winner: this.turn(state) === 0 ? 1 : 0, reason: 'rules' }
    const key = positionKey(state.fen)
    const repeated = state.positions.filter((p) => p === key).length >= 3
    if (game.isStalemate() || game.isInsufficientMaterial() || game.isDrawByFiftyMoves() || repeated) return { draw: true }
    return null
  },

  parseMove(raw) {
    const { from, to, promotion } = (raw ?? {}) as Record<string, unknown>
    if (typeof from !== 'string' || typeof to !== 'string' || !SQUARE.test(from) || !SQUARE.test(to)) throw new IllegalMove('Bad move format.')
    if (promotion !== undefined && !['q', 'r', 'b', 'n'].includes(promotion as string)) throw new IllegalMove('Bad promotion.')
    return promotion === undefined ? { from, to } : { from, to, promotion: promotion as Promotion }
  },
}

/** Why a finished game is a draw, for the status line. */
export function drawReason(state: ChessState): string {
  const game = new Chess(state.fen)
  if (game.isStalemate()) return 'stalemate'
  if (game.isInsufficientMaterial()) return 'insufficient material'
  if (game.isDrawByFiftyMoves()) return 'the 50-move rule'
  return 'threefold repetition'
}
