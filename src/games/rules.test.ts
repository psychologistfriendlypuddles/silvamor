import { describe, expect, it } from 'vitest'
import { IllegalMove, type GameRules } from './types'
import { COLS, ROWS, fourInARow, type FourInARowState } from './fourinarow/rules'
import { SIZES, dotsAndBoxes, dotsAndBoxesRules, geometry, scores, type DotsAndBoxesState } from './dotsandboxes/rules'
import { rulesFor } from './registry'
import { buildListing, parseListing } from '../lib/nostr/gameEvents'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { Chess } from 'chess.js'
import { chess as chessRules, drawReason, type ChessState } from './chess/rules'

/** Applies moves in order, each by whoever's turn it is. */
function playAll<S, M>(rules: GameRules<S, M>, moves: M[]): S {
  return moves.reduce((s, m) => rules.apply(s, m, rules.turn(s)), rules.init())
}

describe('four-in-a-row', () => {
  const drops = (cols: number[]) => playAll(fourInARow, cols.map((col) => ({ col })))

  it('stacks discs from the bottom', () => {
    const s = drops([3, 3])
    expect(s.cells[(ROWS - 1) * COLS + 3]).toBe(0)
    expect(s.cells[(ROWS - 2) * COLS + 3]).toBe(1)
  })

  it('wins vertically, horizontally and on both diagonals', () => {
    expect(fourInARow.outcome(drops([0, 1, 0, 1, 0, 1, 0]))).toMatchObject({ winner: 0 })
    expect(fourInARow.outcome(drops([0, 0, 1, 1, 2, 2, 3]))).toMatchObject({ winner: 0 })
    // Rising diagonal for player 0: (5,0) (4,1) (3,2) (2,3)
    expect(fourInARow.outcome(drops([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]))).toMatchObject({ winner: 0 })
    // Falling diagonal for player 0: (2,3) (3,4) (4,5) (5,6)
    expect(fourInARow.outcome(drops([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]))).toMatchObject({ winner: 0 })
  })

  it('reports the winning line', () => {
    const outcome = fourInARow.outcome(drops([0, 1, 0, 1, 0, 1, 0]))
    expect(outcome && 'line' in outcome && outcome.line).toEqual([2 * COLS, 3 * COLS, 4 * COLS, 5 * COLS])
  })

  it('rejects full columns, wrong turns and nonsense', () => {
    const full = drops([0, 0, 0, 0, 0, 0])
    expect(() => fourInARow.apply(full, { col: 0 }, 0)).toThrow(IllegalMove)
    expect(() => fourInARow.apply(fourInARow.init(), { col: 0 }, 1)).toThrow(IllegalMove)
    expect(() => fourInARow.parseMove({ col: 7 })).toThrow(IllegalMove)
    expect(() => fourInARow.parseMove({ col: '3' })).toThrow(IllegalMove)
  })

  it('is a draw when the board fills up with no four in a row', () => {
    // Fill columns in pairs with a pattern that never lines up four.
    const order = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6]
    const s: FourInARowState = drops(order)
    expect(s.moves).toBe(ROWS * COLS)
    expect(fourInARow.outcome(s)).toEqual({ draw: true })
  })
})

describe('dots and boxes', () => {
  // The 4×4 board of games created without a size option.
  const SIZE = 4
  const { edges: EDGES, hEdge, vEdge, boxEdges } = geometry(SIZE)
  const draw = (edges: number[]) => playAll(dotsAndBoxes, edges.map((edge) => ({ edge })))

  it('numbers every line once, for every board size', () => {
    for (const size of SIZES) {
      const g = geometry(size)
      const all = new Set<number>()
      for (let r = 0; r <= size; r++) for (let c = 0; c < size; c++) all.add(g.hEdge(r, c))
      for (let r = 0; r < size; r++) for (let c = 0; c <= size; c++) all.add(g.vEdge(r, c))
      expect(all.size).toBe(g.edges)
      expect(Math.max(...all)).toBe(g.edges - 1)
      expect(g.edges).toBe(2 * size * (size + 1))
    }
  })

  it('passes the turn when no box is completed', () => {
    expect(draw([hEdge(0, 0)]).turn).toBe(1)
  })

  it('completing a box scores it and earns another turn', () => {
    const [top, bottom, left, right] = boxEdges(0, 0)
    // p0 top, p1 bottom, p0 left, p1 right (completes the box)
    const s: DotsAndBoxesState = draw([top, bottom, left, right])
    expect(s.boxes[0]).toBe(1)
    expect(s.turn).toBe(1)
    expect(scores(s)).toEqual([0, 1])
  })

  it('one line can complete two boxes at once', () => {
    // Two boxes side by side sharing vEdge(0,1); draw everything else first.
    const others = [hEdge(0, 0), hEdge(1, 0), vEdge(0, 0), hEdge(0, 1), hEdge(1, 1), vEdge(0, 2)]
    let s = draw(others)
    const player = s.turn
    s = dotsAndBoxes.apply(s, { edge: vEdge(0, 1) }, player)
    expect(s.boxes[0]).toBe(player)
    expect(s.boxes[1]).toBe(player)
    expect(s.turn).toBe(player)
  })

  it('rejects lines already drawn, wrong turns and nonsense', () => {
    const s = draw([hEdge(0, 0)])
    expect(() => dotsAndBoxes.apply(s, { edge: hEdge(0, 0) }, s.turn)).toThrow(IllegalMove)
    expect(() => dotsAndBoxes.apply(s, { edge: hEdge(1, 0) }, 0)).toThrow(IllegalMove)
    expect(() => dotsAndBoxes.parseMove({ edge: EDGES })).toThrow(IllegalMove)
  })

  it('a full game ends with every box owned and the bigger score winning', () => {
    for (const size of [SIZE, 20]) {
      const rules = dotsAndBoxesRules(size)
      let s = rules.init()
      for (let edge = 0; edge < geometry(size).edges; edge++) s = rules.apply(s, { edge }, s.turn)
      const [a, b] = scores(s)
      expect(a + b).toBe(size * size)
      expect(rules.outcome(s)).toEqual(a === b ? { draw: true } : { winner: a > b ? 0 : 1, reason: 'rules' })
    }
  })

  it('the listing size option picks the board; unsupported sizes are not playable', () => {
    expect(rulesFor('dotsandboxes')!.init().boxes).toHaveLength(16) // no option: the original 4×4
    expect(rulesFor('dotsandboxes', { size: '20' })!.init().boxes).toHaveLength(400)
    expect(rulesFor('dotsandboxes', { size: '10' })!.init().boxes).toHaveLength(100) // older games keep working
    expect(rulesFor('dotsandboxes', { size: '21' })).toBeUndefined()
    expect(rulesFor('dotsandboxes', { size: '1' })).toBeUndefined()
    expect(rulesFor('dotsandboxes', { size: 'big' })).toBeUndefined()
    // Bigger boards accept bigger edge numbers.
    expect(() => rulesFor('dotsandboxes', { size: '8' })!.parseMove({ edge: 100 })).not.toThrow()
    expect(() => rulesFor('dotsandboxes')!.parseMove({ edge: 100 })).toThrow(IllegalMove)
  })

  it('round-trips the size through a game listing', () => {
    const template = buildListing({ id: 'x', game: 'dotsandboxes', status: 'open', access: 'open', blocks: null, pubkeys: [], options: { size: '10' } })
    const listing = parseListing(finalizeEvent(template, generateSecretKey()))!
    expect(listing.options).toEqual({ size: '10' })
    expect(rulesFor(listing.game, listing.options)!.init().boxes).toHaveLength(100)
  })
})

describe('chess', () => {
  /** Plays SAN moves (e.g. "e4", "Qh4#") through our rules, converting each to squares with chess.js. */
  function sans(moves: string[]) {
    const helper = new Chess()
    return playAll(
      chessRules,
      moves.map((san) => {
        const m = helper.move(san)
        return m.promotion ? { from: m.from, to: m.to, promotion: m.promotion as 'q' } : { from: m.from, to: m.to }
      }),
    )
  }

  it('white moves first and turns alternate', () => {
    expect(chessRules.turn(chessRules.init())).toBe(0)
    expect(chessRules.turn(sans(['e4']))).toBe(1)
  })

  it("fool's mate: black checkmates and wins", () => {
    const s: ChessState = sans(['f3', 'e5', 'g4', 'Qh4#'])
    expect(chessRules.outcome(s)).toEqual({ winner: 1, reason: 'rules' })
    expect(s.last).toEqual({ from: 'd8', to: 'h4' })
  })

  it('stalemate is a draw (Sam Loyd’s 10-move stalemate)', () => {
    const s = sans(['e3', 'a5', 'Qh5', 'Ra6', 'Qxa5', 'h5', 'h4', 'Rah6', 'Qxc7', 'f6', 'Qxd7+', 'Kf7', 'Qxb7', 'Qd3', 'Qxb8', 'Qh7', 'Qxc8', 'Kg6', 'Qe6'])
    expect(chessRules.outcome(s)).toEqual({ draw: true })
    expect(drawReason(s)).toBe('stalemate')
  })

  it('threefold repetition is a draw', () => {
    const s = sans(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'])
    expect(chessRules.outcome(s)).toEqual({ draw: true })
    expect(drawReason(s)).toBe('threefold repetition')
  })

  it('rejects illegal moves, wrong turns and nonsense', () => {
    const s = chessRules.init()
    expect(() => chessRules.apply(s, { from: 'e2', to: 'e5' }, 0)).toThrow(IllegalMove)
    expect(() => chessRules.apply(s, { from: 'e7', to: 'e5' }, 1)).toThrow(IllegalMove)
    expect(() => chessRules.parseMove({ from: 'e9', to: 'e4' })).toThrow(IllegalMove)
    expect(() => chessRules.parseMove({ from: 'e7', to: 'e8', promotion: 'k' })).toThrow(IllegalMove)
  })

  it('a pawn reaching the last rank must choose its promotion', () => {
    const s: ChessState = { fen: '8/P7/8/8/8/8/8/k6K w - - 0 1', positions: [], last: null }
    expect(() => chessRules.apply(s, { from: 'a7', to: 'a8' }, 0)).toThrow(IllegalMove)
    const promoted = chessRules.apply(s, { from: 'a7', to: 'a8', promotion: 'n' }, 0)
    expect(promoted.fen.startsWith('N7/')).toBe(true)
  })
})
