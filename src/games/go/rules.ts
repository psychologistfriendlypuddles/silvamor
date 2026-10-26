import { IllegalMove, type GameRules } from '../types'

/** Board sizes offered when creating a game. */
export const SIZES = [9, 13, 19] as const
export const DEFAULT_SIZE = 9
const MIN_SIZE = 5
const MAX_SIZE = 19
/** Points White gets for moving second; the half point rules out draws. */
export const KOMI = 7.5

export type Stone = 0 | 1 | null
export interface GoState {
  size: number
  /** Row-major intersections, row 0 at the top. Player 0 is Black and moves first. */
  board: Stone[]
  turn: 0 | 1
  /** Stones each player has captured. */
  captures: [number, number]
  /** Passes in a row; two end the game. */
  passes: number
  /** Every position so far, for the superko rule (no move may repeat one). */
  history: string[]
  last: number | null
}
export type GoMove = { point: number } | { pass: true }

const key = (board: Stone[]) => board.map((s) => (s === null ? '.' : s)).join('')

export function neighbours(size: number, p: number): number[] {
  const r = Math.floor(p / size)
  const c = p % size
  const out: number[] = []
  if (r > 0) out.push(p - size)
  if (r < size - 1) out.push(p + size)
  if (c > 0) out.push(p - 1)
  if (c < size - 1) out.push(p + 1)
  return out
}

/** The group of stones connected to `p`, and whether it has any liberty. */
function group(board: Stone[], size: number, p: number): { stones: number[]; free: boolean } {
  const color = board[p]
  const stones = [p]
  const seen = new Set(stones)
  let free = false
  for (let i = 0; i < stones.length; i++) {
    for (const n of neighbours(size, stones[i])) {
      if (board[n] === null) free = true
      else if (board[n] === color && !seen.has(n)) {
        seen.add(n)
        stones.push(n)
      }
    }
  }
  return { stones, free }
}

/**
 * Area scoring (Tromp-Taylor): your stones plus the empty points that reach only your
 * stones. Every stone on the board counts as alive, so capture dead stones before passing.
 */
export function score(state: GoState): { black: number; white: number; territory: Stone[] } {
  const { board, size } = state
  const territory: Stone[] = Array(board.length).fill(null)
  const seen = new Set<number>()
  for (let p = 0; p < board.length; p++) {
    if (board[p] !== null || seen.has(p)) continue
    const region = [p]
    const borders = new Set<Stone>()
    seen.add(p)
    for (let i = 0; i < region.length; i++) {
      for (const n of neighbours(size, region[i])) {
        if (board[n] === null) {
          if (!seen.has(n)) {
            seen.add(n)
            region.push(n)
          }
        } else borders.add(board[n])
      }
    }
    if (borders.size === 1) for (const q of region) territory[q] = [...borders][0]
  }
  const area = (who: 0 | 1) => board.filter((s) => s === who).length + territory.filter((t) => t === who).length
  return { black: area(0), white: area(1) + KOMI, territory }
}

export function goRules(size: number): GameRules<GoState, GoMove> {
  return {
    id: 'go',
    name: 'Go',
    emoji: '⚫',
    players: 2,

    init() {
      const board: Stone[] = Array(size * size).fill(null)
      return { size, board, turn: 0, captures: [0, 0], passes: 0, history: [key(board)], last: null }
    },

    turn: (state) => state.turn,

    apply(state, move, player) {
      if (this.outcome(state)) throw new IllegalMove('The game is over.')
      if (player !== state.turn) throw new IllegalMove('Not your turn.')
      const other = (1 - player) as 0 | 1
      if ('pass' in move) return { ...state, turn: other, passes: state.passes + 1, last: null }

      const p = move.point
      if (state.board[p] !== null) throw new IllegalMove('That point is taken.')
      const board = [...state.board]
      board[p] = player as Stone
      let taken = 0
      for (const n of neighbours(size, p)) {
        if (board[n] !== other) continue
        const g = group(board, size, n)
        if (!g.free) {
          for (const s of g.stones) board[s] = null
          taken += g.stones.length
        }
      }
      if (!group(board, size, p).free) throw new IllegalMove('That would be suicide: the stone would have no liberties.')
      const k = key(board)
      if (state.history.includes(k)) throw new IllegalMove('Ko: that would repeat an earlier position.')
      const captures: [number, number] = [...state.captures]
      captures[player] += taken
      return { size, board, turn: other, captures, passes: 0, history: [...state.history, k], last: p }
    },

    outcome(state) {
      if (state.passes < 2) return null
      const { black, white } = score(state)
      return { winner: black > white ? 0 : 1, reason: 'rules' }
    },

    parseMove(raw) {
      const m = raw as { point?: unknown; pass?: unknown }
      if (m?.pass === true) return { pass: true }
      const point = m?.point
      if (typeof point !== 'number' || !Number.isInteger(point) || point < 0 || point >= size * size) throw new IllegalMove('Bad move format.')
      return { point }
    },

    // The listing's `size` option picks the board.
    configure(options) {
      const n = options.size === undefined ? DEFAULT_SIZE : Number(options.size)
      return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE ? goRules(n) : null
    },
  }
}

export const go = goRules(DEFAULT_SIZE)
