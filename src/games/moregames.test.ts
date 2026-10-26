import { describe, expect, it } from 'vitest'
import { IllegalMove, type GameRules } from './types'
import { SIZE as R, counts, legalCells, reversi, type ReversiState } from './reversi/rules'
import { SIZE as G, gomoku } from './gomoku/rules'
import { KOMI, goRules, score, type GoState } from './go/rules'
import { checkers, legalMoves, type CheckersState, type Square } from './checkers/rules'
import { morris, removable, type MorrisState } from './morris/rules'
import { rulesFor } from './registry'

function playAll<S, M>(rules: GameRules<S, M>, moves: M[], from = rules.init()): S {
  return moves.reduce((s, m) => rules.apply(s, m, rules.turn(s)), from)
}
const rc = (size: number) => (r: number, c: number) => r * size + c

describe('reversi', () => {
  const at = rc(R)
  it('starts with four discs and four legal moves for dark', () => {
    const s = reversi.init()
    expect(counts(s.cells)).toEqual([2, 2])
    expect(legalCells(s.cells, 0).sort((a, b) => a - b)).toEqual([at(2, 3), at(3, 2), at(4, 5), at(5, 4)])
  })

  it('flips the discs it traps and rejects moves that flip nothing', () => {
    const s = playAll(reversi, [{ cell: at(2, 3) }])
    expect(s.cells[at(3, 3)]).toBe(0)
    expect(s.flipped).toEqual([at(3, 3)])
    expect(counts(s.cells)).toEqual([4, 1])
    expect(() => reversi.apply(s, { cell: at(0, 0) }, 1)).toThrow(IllegalMove)
  })

  it('passes automatically when the other player has no move, and ends when neither can', () => {
    // Dark owns everything but one corner gap that only dark can fill next to a light disc.
    const cells: ReversiState['cells'] = Array(R * R).fill(0)
    cells[at(0, 0)] = null
    cells[at(0, 1)] = 1
    cells[at(7, 7)] = null
    const s: ReversiState = { cells, turn: 0, last: null, flipped: [], passed: null }
    expect(reversi.outcome(s)).toBeNull()
    const next = reversi.apply(s, { cell: at(0, 0) }, 0)
    expect(reversi.outcome(next)).toEqual({ winner: 0, reason: 'rules' })
  })
})

describe('gomoku', () => {
  const at = rc(G)
  it('five in a row wins, in any direction; overlines count', () => {
    const row = playAll(gomoku, [0, 1, 2, 3, 4].flatMap((c) => [{ cell: at(7, c) }, { cell: at(8, c) }]).slice(0, 9))
    expect(gomoku.outcome(row)).toMatchObject({ winner: 0, line: [0, 1, 2, 3, 4].map((c) => at(7, c)) })
    const diag = playAll(gomoku, [0, 1, 2, 3, 4].flatMap((i) => [{ cell: at(i, i) }, { cell: at(i, 14) }]).slice(0, 9))
    expect(gomoku.outcome(diag)).toMatchObject({ winner: 0 })
    const four = playAll(gomoku, [0, 1, 2, 3].flatMap((c) => [{ cell: at(7, c) }, { cell: at(8, c) }]))
    expect(gomoku.outcome(four)).toBeNull()
  })

  it('rejects taken points', () => {
    const s = playAll(gomoku, [{ cell: 0 }])
    expect(() => gomoku.apply(s, { cell: 0 }, 1)).toThrow(IllegalMove)
  })
})

describe('go', () => {
  const go9 = goRules(9)
  const at = rc(9)
  const play = (moves: ([number, number] | 'pass')[], from?: GoState) =>
    playAll(go9, moves.map((m) => (m === 'pass' ? { pass: true as const } : { point: at(m[0], m[1]) })), from)

  it('captures a surrounded stone', () => {
    // White at (0,1) is surrounded by black at (0,0), (0,2), (1,1).
    const s = play([[0, 0], [0, 1], [0, 2], [8, 8], [1, 1]])
    expect(s.board[at(0, 1)]).toBeNull()
    expect(s.captures).toEqual([1, 0])
  })

  it('suicide is illegal', () => {
    const s = play([[0, 1], [8, 8], [1, 0]])
    expect(() => go9.apply(s, { point: at(0, 0) }, 1)).toThrow(/suicide/)
  })

  it('a ko capture cannot be retaken at once', () => {
    // Classic ko shape around (1,1)/(1,2).
    const s = play([
      [0, 1], [0, 2],
      [1, 0], [1, 3],
      [2, 1], [2, 2],
      [8, 8], [1, 1], // white plays into the eye at (1,1)... captured next
      [1, 2], // black captures white at (1,1)
    ])
    expect(s.board[at(1, 1)]).toBeNull()
    expect(() => go9.apply(s, { point: at(1, 1) }, 1)).toThrow(/Ko/)
  })

  it('two passes end the game; area scoring with komi', () => {
    // Black walls off the left column; everything else is empty but touches only... both.
    const s = play([[0, 0], 'pass', 'pass'])
    const { black, white } = score(s)
    expect(black).toBe(81) // one stone: every empty point reaches only black
    expect(white).toBe(KOMI)
    expect(go9.outcome(s)).toEqual({ winner: 0, reason: 'rules' })
    expect(go9.outcome(play(['pass', 'pass']))).toEqual({ winner: 1, reason: 'rules' }) // komi decides an empty board
  })

  it('board size comes from the listing option', () => {
    expect((rulesFor('go', { size: '13' })!.init() as GoState).size).toBe(13)
    expect((rulesFor('go', {})!.init() as GoState).size).toBe(9)
    expect(rulesFor('go', { size: '40' })).toBeUndefined()
  })
})

describe('checkers', () => {
  const at = rc(8)
  const empty = (): Square[] => Array(64).fill(0)
  const state = (board: Square[], turn: 0 | 1 = 0): CheckersState => ({ board, turn, quiet: 0, last: [], captured: [] })

  it('opens with 7 simple moves for the player at the bottom', () => {
    expect(legalMoves(checkers.init().board, 0)).toHaveLength(7)
  })

  it('captures are compulsory, and multi-jumps are one move', () => {
    const b = empty()
    b[at(7, 0)] = 1
    b[at(6, 1)] = -1
    b[at(4, 3)] = -1
    b[at(0, 7)] = -1
    const moves = legalMoves(b, 0)
    expect(moves).toEqual([{ path: [at(7, 0), at(5, 2), at(3, 4)], captured: [at(6, 1), at(4, 3)] }])
    expect(() => checkers.apply(state(b), { path: [at(7, 0), at(5, 2)] }, 0)).toThrow(IllegalMove)
    const after = checkers.apply(state(b), { path: [at(7, 0), at(5, 2), at(3, 4)] }, 0)
    expect(after.board.filter((s) => s < 0)).toHaveLength(1)
  })

  it('reaching the far row crowns a man, and kings move backwards', () => {
    const b = empty()
    b[at(1, 2)] = 1
    b[at(7, 0)] = -1
    const s = checkers.apply(state(b), { path: [at(1, 2), at(0, 1)] }, 0)
    expect(s.board[at(0, 1)]).toBe(2)
    const back = checkers.apply({ ...s, turn: 0 }, { path: [at(0, 1), at(1, 0)] }, 0)
    expect(back.board[at(1, 0)]).toBe(2)
  })

  it('a player with no pieces or moves loses; quiet king moves end in a draw', () => {
    const b = empty()
    b[at(4, 3)] = 2
    expect(checkers.outcome(state(b, 1))).toEqual({ winner: 0, reason: 'rules' })
    const kings = empty()
    kings[at(4, 3)] = 2
    kings[at(0, 1)] = -2
    expect(checkers.outcome({ ...state(kings), quiet: 80 })).toEqual({ draw: true })
  })
})

describe("nine men's morris", () => {
  const place = (points: number[], from = morris.init()) => playAll(morris, points.map((to) => ({ to })), from)

  it('placing a mill removes an opponent piece, and only then', () => {
    const s = place([0, 3, 1, 4])
    expect(() => morris.apply(s, { to: 2 }, 0)).toThrow(/mill/)
    const after = morris.apply(s, { to: 2, remove: 3 }, 0)
    expect(after.board[3]).toBeNull()
    expect(() => morris.apply(place([0, 3]), { to: 9, remove: 3 }, 0)).toThrow(/Only a mill/)
  })

  it("pieces in a mill are safe unless all of them are", () => {
    const board: MorrisState['board'] = Array(24).fill(null)
    board[0] = board[1] = board[2] = 1
    board[9] = 1
    expect(removable(board, 1)).toEqual([9])
    board[9] = null
    expect(removable(board, 1)).toEqual([0, 1, 2])
  })

  it('after placing, pieces slide to neighbours; with three they fly', () => {
    const s: MorrisState = { board: Array(24).fill(null), inHand: [0, 0], turn: 0, quiet: 0, last: null }
    s.board[0] = s.board[9] = s.board[21] = s.board[3] = 0
    s.board[23] = s.board[22] = s.board[14] = 1
    expect(() => morris.apply(s, { from: 3, to: 20 }, 0)).toThrow(IllegalMove)
    const slid = morris.apply(s, { from: 3, to: 4 }, 0)
    expect(morris.apply(slid, { from: 22, to: 7 }, 1).board[7]).toBe(1) // white has 3: flies
  })

  it('fewer than three pieces, or no move, loses', () => {
    const s: MorrisState = { board: Array(24).fill(null), inHand: [0, 0], turn: 0, quiet: 0, last: null }
    s.board[0] = s.board[1] = s.board[2] = 0
    s.board[23] = s.board[22] = 1
    expect(morris.outcome(s)).toEqual({ winner: 0, reason: 'rules' })
  })
})
