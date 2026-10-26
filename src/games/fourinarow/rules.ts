import { IllegalMove, type GameRules } from '../types'

export const COLS = 7
export const ROWS = 6

export type Disc = 0 | 1 | null
export interface FourInARowState {
  /** Row-major from the top-left: index = row * COLS + col, row 0 at the top. */
  cells: Disc[]
  moves: number
  /** Cell filled by the last move, for the drop animation. */
  last: number | null
}
export interface FourInARowMove {
  col: number
}

/** The lowest empty cell in a column, or -1 when the column is full. */
export function landingCell(cells: Disc[], col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (cells[row * COLS + col] === null) return row * COLS + col
  }
  return -1
}

/** Every run of four cells: horizontal, vertical and both diagonals. */
const LINES: number[][] = (() => {
  const lines: number[][] = []
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      for (const [dr, dc] of directions) {
        const line = [0, 1, 2, 3].map((i) => [row + i * dr, col + i * dc])
        if (line.every(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS)) lines.push(line.map(([r, c]) => r * COLS + c))
      }
    }
  }
  return lines
})()

export const fourInARow: GameRules<FourInARowState, FourInARowMove> = {
  id: 'fourinarow',
  name: 'Four-in-a-Row',
  emoji: '🔴',
  players: 2,

  init: () => ({ cells: Array(ROWS * COLS).fill(null), moves: 0, last: null }),

  turn: (state) => state.moves % 2,

  apply(state, move, player) {
    if (this.outcome(state)) throw new IllegalMove('The game is over.')
    if (player !== this.turn(state)) throw new IllegalMove('Not your turn.')
    const cell = landingCell(state.cells, move.col)
    if (cell < 0) throw new IllegalMove('That column is full.')
    const cells = [...state.cells]
    cells[cell] = player as Disc
    return { cells, moves: state.moves + 1, last: cell }
  },

  outcome(state) {
    for (const line of LINES) {
      const v = state.cells[line[0]]
      if (v !== null && line.every((i) => state.cells[i] === v)) return { winner: v, line, reason: 'rules' }
    }
    return state.moves >= ROWS * COLS ? { draw: true } : null
  },

  parseMove(raw) {
    const col = (raw as { col?: unknown })?.col
    if (typeof col !== 'number' || !Number.isInteger(col) || col < 0 || col >= COLS) throw new IllegalMove('Bad move format.')
    return { col }
  },
}
