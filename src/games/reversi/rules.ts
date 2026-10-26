import { IllegalMove, type GameRules } from '../types'

export const SIZE = 8

export type Disc = 0 | 1 | null
export interface ReversiState {
  /** Row-major, row 0 at the top. Player 0 (dark) moves first. */
  cells: Disc[]
  turn: 0 | 1
  /** Cell placed by the last move, and the discs it flipped (for the animation). */
  last: number | null
  flipped: number[]
  /** The player who just had to pass because they had no legal move, if any. */
  passed: 0 | 1 | null
}
export interface ReversiMove {
  cell: number
}

const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
]

/** The discs `player` would flip by playing `cell` (empty if the move isn't legal). */
export function flipsFor(cells: Disc[], cell: number, player: 0 | 1): number[] {
  if (cells[cell] !== null) return []
  const row = Math.floor(cell / SIZE)
  const col = cell % SIZE
  const flips: number[] = []
  for (const [dr, dc] of DIRECTIONS) {
    const run: number[] = []
    let r = row + dr
    let c = col + dc
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && cells[r * SIZE + c] === 1 - player) {
      run.push(r * SIZE + c)
      r += dr
      c += dc
    }
    if (run.length && r >= 0 && r < SIZE && c >= 0 && c < SIZE && cells[r * SIZE + c] === player) flips.push(...run)
  }
  return flips
}

export function legalCells(cells: Disc[], player: 0 | 1): number[] {
  return cells.map((_, i) => i).filter((i) => flipsFor(cells, i, player).length > 0)
}

export function counts(cells: Disc[]): [number, number] {
  return [cells.filter((c) => c === 0).length, cells.filter((c) => c === 1).length]
}

export const reversi: GameRules<ReversiState, ReversiMove> = {
  id: 'reversi',
  name: 'Reversi',
  emoji: '🌓',
  players: 2,

  init() {
    const cells: Disc[] = Array(SIZE * SIZE).fill(null)
    const mid = SIZE / 2
    cells[(mid - 1) * SIZE + mid - 1] = 1
    cells[mid * SIZE + mid] = 1
    cells[(mid - 1) * SIZE + mid] = 0
    cells[mid * SIZE + mid - 1] = 0
    return { cells, turn: 0, last: null, flipped: [], passed: null }
  },

  turn: (state) => state.turn,

  apply(state, move, player) {
    if (this.outcome(state)) throw new IllegalMove('The game is over.')
    if (player !== state.turn) throw new IllegalMove('Not your turn.')
    const flips = flipsFor(state.cells, move.cell, state.turn)
    if (!flips.length) throw new IllegalMove('A move must flip at least one disc.')
    const cells = [...state.cells]
    cells[move.cell] = state.turn
    for (const i of flips) cells[i] = state.turn
    // A player with no legal move passes automatically; if neither can move, the game is over.
    const other = (1 - state.turn) as 0 | 1
    const otherCanMove = legalCells(cells, other).length > 0
    const turn = otherCanMove ? other : state.turn
    return { cells, turn, last: move.cell, flipped: flips, passed: otherCanMove || !legalCells(cells, state.turn).length ? null : other }
  },

  outcome(state) {
    if (legalCells(state.cells, 0).length || legalCells(state.cells, 1).length) return null
    const [a, b] = counts(state.cells)
    return a === b ? { draw: true } : { winner: a > b ? 0 : 1, reason: 'rules' }
  },

  parseMove(raw) {
    const cell = (raw as { cell?: unknown })?.cell
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) throw new IllegalMove('Bad move format.')
    return { cell }
  },
}
