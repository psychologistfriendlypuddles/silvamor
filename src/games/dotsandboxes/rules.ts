import { IllegalMove, type GameRules } from '../types'

/** Board sizes offered when creating a game, in boxes per side (so size + 1 dots per side). */
export const SIZES = [8, 12, 16, 20] as const
export const DEFAULT_SIZE = 8
/** Listings without a size option are 4×4: that's how the first games were made. */
const LEGACY_SIZE = 4
/** Any size in this range plays fine (older games used 4 and 10), even if not offered anymore. */
const MIN_SIZE = 2
const MAX_SIZE = 20

/**
 * Line ("edge") numbering for an N×N board: horizontal edges first, row by row
 * (h(r, c) = r * N + c, r in 0..N, c in 0..N-1), then vertical ones
 * (v(r, c) = (N + 1) * N + r * (N + 1) + c, r in 0..N-1, c in 0..N).
 */
export function geometry(size: number) {
  const hEdges = (size + 1) * size
  const hEdge = (r: number, c: number) => r * size + c
  const vEdge = (r: number, c: number) => hEdges + r * (size + 1) + c
  return {
    size,
    hEdges,
    edges: hEdges + size * (size + 1),
    hEdge,
    vEdge,
    /** The four edges around box (r, c): top, bottom, left, right. */
    boxEdges: (r: number, c: number) => [hEdge(r, c), hEdge(r + 1, c), vEdge(r, c), vEdge(r, c + 1)],
    /** The boxes (row-major indices) that an edge borders. */
    boxesOf(edge: number): number[] {
      const boxes: number[] = []
      if (edge < hEdges) {
        const r = Math.floor(edge / size)
        const c = edge % size
        if (r > 0) boxes.push((r - 1) * size + c)
        if (r < size) boxes.push(r * size + c)
      } else {
        const r = Math.floor((edge - hEdges) / (size + 1))
        const c = (edge - hEdges) % (size + 1)
        if (c > 0) boxes.push(r * size + c - 1)
        if (c < size) boxes.push(r * size + c)
      }
      return boxes
    },
  }
}

export type Owner = 0 | 1 | null
export interface DotsAndBoxesState {
  /** Who drew each edge, or null if not drawn yet. */
  edges: Owner[]
  /** Who completed each box (row-major), or null. The board is sqrt(boxes.length) boxes wide. */
  boxes: Owner[]
  /** Completing a box earns another turn, so whose turn it is is tracked explicitly. */
  turn: number
  /** Edge drawn by the last move, for highlighting. */
  last: number | null
}
export interface DotsAndBoxesMove {
  edge: number
}

export const sizeOf = (state: DotsAndBoxesState) => Math.round(Math.sqrt(state.boxes.length))
export const scores = (state: DotsAndBoxesState) => [0, 1].map((p) => state.boxes.filter((b) => b === p).length)

/** Dots and boxes rules for an N×N board. */
export function dotsAndBoxesRules(size: number): GameRules<DotsAndBoxesState, DotsAndBoxesMove> {
  const g = geometry(size)
  return {
    id: 'dotsandboxes',
    name: 'Dots and Boxes',
    emoji: '🔲',
    players: 2,

    init: () => ({ edges: Array(g.edges).fill(null), boxes: Array(size * size).fill(null), turn: 0, last: null }),

    turn: (state) => state.turn,

    // Running out of time passes the turn to the other player (and costs a strike).
    onStrike: (state, player) => ({ ...state, turn: 1 - player }),

    apply(state, move, player) {
      if (this.outcome(state)) throw new IllegalMove('The game is over.')
      if (player !== state.turn) throw new IllegalMove('Not your turn.')
      if (state.edges[move.edge] !== null) throw new IllegalMove('That line is already drawn.')
      const edges = [...state.edges]
      edges[move.edge] = player as Owner
      const boxes = [...state.boxes]
      let completed = 0
      for (const b of g.boxesOf(move.edge)) {
        if (g.boxEdges(Math.floor(b / size), b % size).every((e) => edges[e] !== null)) {
          boxes[b] = player as Owner
          completed++
        }
      }
      // Completing a box (or two) earns another turn.
      return { edges, boxes, turn: completed > 0 ? player : (player + 1) % 2, last: move.edge }
    },

    outcome(state) {
      if (state.boxes.some((b) => b === null)) return null
      const [a, b] = scores(state)
      return a === b ? { draw: true } : { winner: a > b ? 0 : 1, reason: 'rules' }
    },

    parseMove(raw) {
      const edge = (raw as { edge?: unknown })?.edge
      if (typeof edge !== 'number' || !Number.isInteger(edge) || edge < 0 || edge >= g.edges) throw new IllegalMove('Bad move format.')
      return { edge }
    },

    // The listing's `size` option picks the board.
    configure(options) {
      const size = options.size === undefined ? LEGACY_SIZE : Number(options.size)
      return Number.isInteger(size) && size >= MIN_SIZE && size <= MAX_SIZE ? dotsAndBoxesRules(size) : null
    },
  }
}

export const dotsAndBoxes = dotsAndBoxesRules(LEGACY_SIZE)
