import { IllegalMove, type GameRules } from '../types'

export const SIZE = 15
/** Five or more in a row wins ("freestyle"). */
const TO_WIN = 5

export type Stone = 0 | 1 | null
export interface GomokuState {
  /** Row-major intersections, row 0 at the top. Player 0 (black) moves first. */
  cells: Stone[]
  moves: number
  last: number | null
}
export interface GomokuMove {
  cell: number
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

/** The longest line of five or more through any stone, or null. */
export function winningLine(cells: Stone[]): number[] | null {
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]
    if (v === null) continue
    const row = Math.floor(i / SIZE)
    const col = i % SIZE
    for (const [dr, dc] of DIRECTIONS) {
      // Only start counting at the first stone of a run.
      const pr = row - dr
      const pc = col - dc
      if (pr >= 0 && pr < SIZE && pc >= 0 && pc < SIZE && cells[pr * SIZE + pc] === v) continue
      const line = [i]
      let r = row + dr
      let c = col + dc
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && cells[r * SIZE + c] === v) {
        line.push(r * SIZE + c)
        r += dr
        c += dc
      }
      if (line.length >= TO_WIN) return line
    }
  }
  return null
}

export const gomoku: GameRules<GomokuState, GomokuMove> = {
  id: 'gomoku',
  name: 'Gomoku',
  emoji: '⚪',
  players: 2,

  init: () => ({ cells: Array(SIZE * SIZE).fill(null), moves: 0, last: null }),

  turn: (state) => state.moves % 2,

  apply(state, move, player) {
    if (this.outcome(state)) throw new IllegalMove('The game is over.')
    if (player !== this.turn(state)) throw new IllegalMove('Not your turn.')
    if (state.cells[move.cell] !== null) throw new IllegalMove('That point is taken.')
    const cells = [...state.cells]
    cells[move.cell] = player as Stone
    return { cells, moves: state.moves + 1, last: move.cell }
  },

  outcome(state) {
    const line = winningLine(state.cells)
    if (line) return { winner: state.cells[line[0]]!, line, reason: 'rules' }
    return state.moves >= SIZE * SIZE ? { draw: true } : null
  },

  parseMove(raw) {
    const cell = (raw as { cell?: unknown })?.cell
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) throw new IllegalMove('Bad move format.')
    return { cell }
  },
}
