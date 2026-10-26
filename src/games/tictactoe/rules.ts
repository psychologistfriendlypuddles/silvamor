import { IllegalMove, type GameRules } from '../types'

export type Cell = 0 | 1 | null
export interface TicTacToeState {
  cells: Cell[]
  moves: number
}
export interface TicTacToeMove {
  cell: number
}

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

export const ticTacToe: GameRules<TicTacToeState, TicTacToeMove> = {
  id: 'tictactoe',
  name: 'Tic-Tac-Toe',
  emoji: '❌',
  players: 2,

  init: () => ({ cells: Array(9).fill(null), moves: 0 }),

  turn: (state) => state.moves % 2,

  apply(state, move, player) {
    if (this.outcome(state)) throw new IllegalMove('The game is over.')
    if (player !== this.turn(state)) throw new IllegalMove('Not your turn.')
    if (state.cells[move.cell] !== null) throw new IllegalMove('That square is taken.')
    const cells = [...state.cells]
    cells[move.cell] = player as Cell
    return { cells, moves: state.moves + 1 }
  },

  outcome(state) {
    for (const line of LINES) {
      const [a, b, c] = line
      const v = state.cells[a]
      if (v !== null && v === state.cells[b] && v === state.cells[c]) return { winner: v, line, reason: 'rules' }
    }
    return state.moves >= 9 ? { draw: true } : null
  },

  parseMove(raw) {
    const cell = (raw as { cell?: unknown })?.cell
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 8) {
      throw new IllegalMove('Bad move format.')
    }
    return { cell }
  },
}
