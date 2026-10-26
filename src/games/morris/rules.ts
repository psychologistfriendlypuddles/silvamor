import { IllegalMove, type GameRules } from '../types'

export const PIECES = 9
/** Draw after this many moves in a row (both players) without a piece being removed. */
export const QUIET_LIMIT = 100

/**
 * The 24 points, numbered row by row on a 7×7 grid:
 *
 *   0 ----- 1 ----- 2
 *   |  3 -- 4 -- 5  |
 *   |  |  6-7-8  |  |
 *   9-10-11   12-13-14
 *   |  | 15-16-17 |  |
 *   |  18 -19 -20   |
 *   21 ---- 22 ---- 23
 */
export const POINTS: [number, number][] = [
  [0, 0], [0, 3], [0, 6],
  [1, 1], [1, 3], [1, 5],
  [2, 2], [2, 3], [2, 4],
  [3, 0], [3, 1], [3, 2], [3, 4], [3, 5], [3, 6],
  [4, 2], [4, 3], [4, 4],
  [5, 1], [5, 3], [5, 5],
  [6, 0], [6, 3], [6, 6],
]

/** Every line of three; neighbouring points along a line are connected. */
export const MILLS: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
  [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7], [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23],
]

export const ADJACENT: number[][] = (() => {
  const adj: number[][] = POINTS.map(() => [])
  for (const [a, b, c] of MILLS) {
    adj[a].push(b)
    adj[b].push(a, c)
    adj[c].push(b)
  }
  return adj
})()

export type Piece = 0 | 1 | null
export interface MorrisState {
  board: Piece[]
  /** Pieces each player still has to place. Player 0 places first. */
  inHand: [number, number]
  turn: 0 | 1
  /** Moves since a piece was last removed (for the draw rule). */
  quiet: number
  last: { from: number | null; to: number; removed: number | null } | null
}
/** Place (`to`) or move (`from` → `to`); a move that closes a mill also names the piece it removes. */
export interface MorrisMove {
  to: number
  from?: number
  remove?: number
}

export const onBoard = (s: MorrisState, p: 0 | 1) => s.board.filter((x) => x === p).length
const inMill = (board: Piece[], point: number) => board[point] !== null && MILLS.some((m) => m.includes(point) && m.every((q) => board[q] === board[point]))

/** How a player moves now: placing pieces, sliding to a neighbour, or flying anywhere (down to 3). */
export function phase(s: MorrisState, p: 0 | 1): 'place' | 'move' | 'fly' {
  if (s.inHand[p] > 0) return 'place'
  return onBoard(s, p) === 3 ? 'fly' : 'move'
}

/** Where the piece on `from` can go (or, while placing, every empty point). */
export function targets(s: MorrisState, p: 0 | 1, from?: number): number[] {
  const empty = s.board.map((_, i) => i).filter((i) => s.board[i] === null)
  const ph = phase(s, p)
  if (ph === 'place') return from === undefined ? empty : []
  if (from === undefined || s.board[from] !== p) return []
  return ph === 'fly' ? empty : ADJACENT[from].filter((q) => s.board[q] === null)
}

/** Whether moving/placing a piece of `p` to `to` (from `from`) closes a mill. */
export function closesMill(s: MorrisState, p: 0 | 1, to: number, from?: number): boolean {
  const board = [...s.board]
  if (from !== undefined) board[from] = null
  board[to] = p
  return inMill(board, to)
}

/** Opponent pieces that may be removed: not in a mill, unless all of them are. */
export function removable(board: Piece[], opponent: 0 | 1): number[] {
  const theirs = board.map((_, i) => i).filter((i) => board[i] === opponent)
  const loose = theirs.filter((i) => !inMill(board, i))
  return loose.length ? loose : theirs
}

function canMove(s: MorrisState, p: 0 | 1) {
  if (phase(s, p) === 'place') return true
  return s.board.some((x, i) => x === p && targets(s, p, i).length > 0)
}

export const morris: GameRules<MorrisState, MorrisMove> = {
  id: 'morris',
  name: "Nine Men's Morris",
  emoji: '🟡',
  players: 2,

  init: () => ({ board: Array(24).fill(null), inHand: [PIECES, PIECES], turn: 0, quiet: 0, last: null }),

  turn: (state) => state.turn,

  apply(state, move, player) {
    if (this.outcome(state)) throw new IllegalMove('The game is over.')
    if (player !== state.turn) throw new IllegalMove('Not your turn.')
    const p = state.turn
    const placing = phase(state, p) === 'place'
    if (placing !== (move.from === undefined)) throw new IllegalMove(placing ? 'Place a piece first.' : 'Move one of your pieces.')
    if (!targets(state, p, move.from).includes(move.to)) throw new IllegalMove('That move isn’t allowed.')

    const board = [...state.board]
    if (move.from !== undefined) board[move.from] = null
    board[move.to] = p
    const mill = inMill(board, move.to)
    if (mill !== (move.remove !== undefined)) throw new IllegalMove(mill ? 'A mill removes one of your opponent’s pieces: pick one.' : 'Only a mill removes a piece.')
    if (move.remove !== undefined) {
      if (!removable(board, (1 - p) as 0 | 1).includes(move.remove)) throw new IllegalMove('That piece can’t be removed.')
      board[move.remove] = null
    }
    const inHand: [number, number] = [...state.inHand]
    if (placing) inHand[p] -= 1
    return {
      board,
      inHand,
      turn: (1 - p) as 0 | 1,
      quiet: move.remove !== undefined ? 0 : state.quiet + 1,
      last: { from: move.from ?? null, to: move.to, removed: move.remove ?? null },
    }
  },

  outcome(state) {
    for (const p of [0, 1] as const) {
      if (state.inHand[p] + onBoard(state, p) < 3) return { winner: 1 - p, reason: 'rules' }
    }
    if (!canMove(state, state.turn)) return { winner: 1 - state.turn, reason: 'rules' }
    return state.quiet >= QUIET_LIMIT ? { draw: true } : null
  },

  parseMove(raw) {
    const m = raw as { to?: unknown; from?: unknown; remove?: unknown }
    const point = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24
    if (!point(m?.to) || (m.from !== undefined && !point(m.from)) || (m.remove !== undefined && !point(m.remove))) throw new IllegalMove('Bad move format.')
    return { to: m.to as number, ...(m.from !== undefined && { from: m.from as number }), ...(m.remove !== undefined && { remove: m.remove as number }) }
  },
}
