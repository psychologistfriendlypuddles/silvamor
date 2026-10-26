import { IllegalMove, type GameRules } from '../types'

export const SIZE = 8
/** Draw after this many moves in a row (both players) without a capture or a man moving. */
export const QUIET_LIMIT = 80

/**
 * Squares, row-major from the top-left; only dark squares ((row + col) odd) are used.
 * 0 empty, 1 / 2 = player 0's man / king, -1 / -2 = player 1's man / king.
 * Player 0 starts at the bottom, moves up, and goes first.
 */
export type Square = -2 | -1 | 0 | 1 | 2
export interface CheckersState {
  board: Square[]
  turn: 0 | 1
  /** Moves since the last capture or man move (for the draw rule). */
  quiet: number
  /** Squares visited by the last move, and the squares it captured. */
  last: number[]
  captured: number[]
}
/** The squares a piece visits: its start, then each landing square (several for a multi-jump). */
export interface CheckersMove {
  path: number[]
}

export const ownerOf = (s: Square): 0 | 1 | null => (s > 0 ? 0 : s < 0 ? 1 : null)
export const isKing = (s: Square) => Math.abs(s) === 2
const at = (r: number, c: number) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : -1)

function directions(piece: Square): [number, number][] {
  if (isKing(piece)) {
    return [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]
  }
  return piece > 0
    ? [
        [-1, -1],
        [-1, 1],
      ]
    : [
        [1, -1],
        [1, 1],
      ]
}

const crowns = (piece: Square, square: number) => !isKing(piece) && Math.floor(square / SIZE) === (piece > 0 ? 0 : SIZE - 1)

/** Every jump sequence from `from`, continuing while more jumps are possible (crowning ends a move). */
function jumps(board: Square[], from: number, piece: Square): { path: number[]; captured: number[] }[] {
  const out: { path: number[]; captured: number[] }[] = []
  const walk = (b: Square[], sq: number, path: number[], captured: number[]) => {
    let extended = false
    const r = Math.floor(sq / SIZE)
    const c = sq % SIZE
    for (const [dr, dc] of directions(piece)) {
      const over = at(r + dr, c + dc)
      const land = at(r + 2 * dr, c + 2 * dc)
      if (over < 0 || land < 0 || b[land] !== 0 || ownerOf(b[over]) !== 1 - ownerOf(piece)!) continue
      extended = true
      const next = [...b]
      next[land] = piece
      next[sq] = 0
      next[over] = 0
      if (crowns(piece, land)) out.push({ path: [...path, land], captured: [...captured, over] })
      else walk(next, land, [...path, land], [...captured, over])
    }
    if (!extended && captured.length) out.push({ path, captured })
  }
  walk(board, from, [from], [])
  return out
}

/** All legal moves for `player`: captures are compulsory when any exist. */
export function legalMoves(board: Square[], player: 0 | 1): { path: number[]; captured: number[] }[] {
  const mine = board.map((_, i) => i).filter((i) => ownerOf(board[i]) === player)
  const captures = mine.flatMap((i) => jumps(board, i, board[i]))
  if (captures.length) return captures
  return mine.flatMap((i) => {
    const r = Math.floor(i / SIZE)
    const c = i % SIZE
    return directions(board[i])
      .map(([dr, dc]) => at(r + dr, c + dc))
      .filter((to) => to >= 0 && board[to] === 0)
      .map((to) => ({ path: [i, to], captured: [] }))
  })
}

export const checkers: GameRules<CheckersState, CheckersMove> = {
  id: 'checkers',
  name: 'Checkers',
  emoji: '🏁',
  players: 2,

  init() {
    const board: Square[] = Array(SIZE * SIZE).fill(0)
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((r + c) % 2 === 0) continue
        if (r < 3) board[r * SIZE + c] = -1
        if (r > 4) board[r * SIZE + c] = 1
      }
    }
    return { board, turn: 0, quiet: 0, last: [], captured: [] }
  },

  turn: (state) => state.turn,

  apply(state, move, player) {
    if (this.outcome(state)) throw new IllegalMove('The game is over.')
    if (player !== state.turn) throw new IllegalMove('Not your turn.')
    const legal = legalMoves(state.board, state.turn)
    const found = legal.find((m) => m.path.length === move.path.length && m.path.every((sq, i) => sq === move.path[i]))
    if (!found) throw new IllegalMove(legal.some((m) => m.captured.length) ? 'You must capture.' : 'That move isn’t allowed.')
    const board = [...state.board]
    const from = move.path[0]
    const to = move.path[move.path.length - 1]
    const piece = board[from]
    board[from] = 0
    for (const sq of found.captured) board[sq] = 0
    board[to] = crowns(piece, to) ? ((piece * 2) as Square) : piece
    const quiet = found.captured.length || !isKing(piece) ? 0 : state.quiet + 1
    return { board, turn: (1 - state.turn) as 0 | 1, quiet, last: move.path, captured: found.captured }
  },

  outcome(state) {
    // No pieces or no legal move: the player to move loses.
    if (!legalMoves(state.board, state.turn).length) return { winner: 1 - state.turn, reason: 'rules' }
    return state.quiet >= QUIET_LIMIT ? { draw: true } : null
  },

  parseMove(raw) {
    const path = (raw as { path?: unknown })?.path
    if (!Array.isArray(path) || path.length < 2 || path.length > 13 || !path.every((sq) => Number.isInteger(sq) && sq >= 0 && sq < SIZE * SIZE)) {
      throw new IllegalMove('Bad move format.')
    }
    return { path: path as number[] }
  },
}
