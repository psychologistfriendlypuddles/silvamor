import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ticTacToe } from '../games/tictactoe/rules'
import { dotsAndBoxes } from '../games/dotsandboxes/rules'
import { buildAction, buildListing, parseAction, parseListing, type ActionContent, type GameAction } from './nostr/gameEvents'
import { inviteKey, makeJoinProof, newInviteToken, readInviteFragment, inviteFragment, verifyJoinProof } from './gameCrypto'
import { replay } from './replay'

const hostSk = generateSecretKey()
const guestSk = generateSecretKey()
const strangerSk = generateSecretKey()
const host = getPublicKey(hostSk)
const guest = getPublicKey(guestSk)

const listing = parseListing(
  finalizeEvent(
    buildListing({ id: 'abc', game: 'tictactoe', status: 'active', access: 'open', blocks: null, pubkeys: [] }),
    hostSk,
  ),
)!

let clock = 1_700_000_000
function act(sk: Uint8Array, content: ActionContent, prev?: GameAction, block?: number): GameAction {
  const template = buildAction(listing, content, { prev: prev?.event.id, others: [], block })
  template.created_at = clock++
  return parseAction(finalizeEvent(template, sk))
}

/** Plays cells alternately starting with players[0]; returns all actions. */
function play(cells: number[], players = [host, guest]) {
  const sks = players.map((p) => (p === host ? hostSk : guestSk))
  const start = act(hostSk, { type: 'start', n: 0, players })
  const actions = [start]
  cells.forEach((cell, i) => actions.push(act(sks[i % 2], { type: 'move', n: i + 1, move: { cell } }, actions[actions.length - 1])))
  return actions
}

describe('tic-tac-toe replay', () => {
  it('detects a win for the first player', () => {
    const r = replay(ticTacToe, host, play([0, 3, 1, 4, 2]))
    expect(r.outcome).toEqual({ winner: 0, line: [0, 1, 2], reason: 'rules' })
    expect(r.turn).toBeNull()
    expect(r.steps).toHaveLength(6)
  })

  it('detects a draw', () => {
    const r = replay(ticTacToe, host, play([0, 1, 2, 4, 3, 5, 7, 6, 8]))
    expect(r.outcome).toEqual({ draw: true })
  })

  it('is order-independent', () => {
    const actions = play([4, 0, 8])
    const r1 = replay(ticTacToe, host, actions)
    const r2 = replay(ticTacToe, host, [...actions].reverse())
    expect(r2.state).toEqual(r1.state)
    expect(r2.tip).toEqual(r1.tip)
  })

  it('ignores a start not signed by the host', () => {
    const fake = act(guestSk, { type: 'start', n: 0, players: [guest, host] })
    expect(replay(ticTacToe, host, [fake]).started).toBe(false)
  })

  it('ignores moves out of turn, by strangers, on taken squares, or with a wrong n', () => {
    const actions = play([4])
    const tip = actions[1]
    const bad = [
      act(hostSk, { type: 'move', n: 2, move: { cell: 0 } }, tip), // host moves twice
      act(strangerSk, { type: 'move', n: 2, move: { cell: 0 } }, tip), // not a player
      act(guestSk, { type: 'move', n: 2, move: { cell: 4 } }, tip), // taken
      act(guestSk, { type: 'move', n: 5, move: { cell: 0 } }, tip), // wrong n
      act(guestSk, { type: 'move', n: 2, move: { cell: 42 } }, tip), // nonsense
    ]
    const r = replay(ticTacToe, host, [...actions, ...bad])
    expect(r.steps).toHaveLength(2)
    expect(r.turn).toBe(1)
    expect(r.forked).toBe(false)
  })

  it('handles resignation by the player not on turn', () => {
    const actions = play([4])
    actions.push(act(hostSk, { type: 'resign', n: 2 }, actions[1]))
    expect(replay(ticTacToe, host, actions).outcome).toEqual({ winner: 1, reason: 'resign' })
  })

  it('flags equivocation and picks deterministically', () => {
    const actions = play([4])
    const a = act(guestSk, { type: 'move', n: 2, move: { cell: 0 } }, actions[1])
    const b = act(guestSk, { type: 'move', n: 2, move: { cell: 8 } }, actions[1])
    const r = replay(ticTacToe, host, [...actions, b, a])
    expect(r.forked).toBe(true)
    expect(r.tip?.id).toBe(a.event.id) // earlier created_at wins
  })
})

describe('invite links', () => {
  it('accepts a proof only from the joiner it was made for', async () => {
    const token = newInviteToken()
    const key = await inviteKey(token)
    const proof = makeJoinProof(guest, key)
    expect(verifyJoinProof(proof, guest, key)).toBe(true)
    // Someone copying the proof off a relay can't use it for themselves.
    expect(verifyJoinProof(proof, getPublicKey(strangerSk), key)).toBe(false)
    // A wrong or guessed token doesn't verify.
    expect(verifyJoinProof(proof, guest, await inviteKey(newInviteToken()))).toBe(false)
    expect(verifyJoinProof('garbage', guest, key)).toBe(false)
  })

  it('round-trips the token through the URL fragment', () => {
    const token = newInviteToken()
    expect(readInviteFragment(inviteFragment(token))).toBe(token)
    expect(readInviteFragment('#invite=nope')).toBeNull()
    expect(readInviteFragment('')).toBeNull()
  })
})

describe('turn clock in Bitcoin blocks (3 blocks per turn, game starts at 800,000)', () => {
  // Host moves first in these games. Every strike lands S blocks after the previous event.
  const start = () => act(hostSk, { type: 'start', n: 0, players: [host, guest] }, undefined, 800_000)
  const at = (height: number, settled = height) => ({ blocks: 3, knownHeight: height, settledHeight: settled })

  it('strikes land at start + S, then every S blocks, and the third one loses', () => {
    const actions = [start()]
    expect(replay(ticTacToe, host, actions, at(800_002))).toMatchObject({ pendingStrikes: 0, nextStrikeAt: 800_003, outcome: null })
    expect(replay(ticTacToe, host, actions, at(800_003))).toMatchObject({ pendingStrikes: 1, strikesDue: [800_003], nextStrikeAt: 800_006 })
    expect(replay(ticTacToe, host, actions, at(800_006))).toMatchObject({ pendingStrikes: 2, strikesDue: [800_003, 800_006], nextStrikeAt: 800_009 })
    expect(replay(ticTacToe, host, actions, at(800_008)).outcome).toBeNull()
    expect(replay(ticTacToe, host, actions, at(800_009)).outcome).toEqual({ winner: 1, reason: 'strikes' })
  })

  it('a move recording block start + S - 1 is on time; one recording start + S carries a strike', () => {
    const s = start()
    const onTime = replay(ticTacToe, host, [s, act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 800_002)], at(800_002))
    expect(onTime.strikes).toEqual([0, 0])
    const late = replay(ticTacToe, host, [s, act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 800_003)], at(800_003))
    expect(late.steps).toHaveLength(2)
    expect(late.strikes).toEqual([1, 0])
  })

  it('continuation: back at 800,004 with one strike, opponent replies at 800,004, strike two at 800,007, out at 800,010', () => {
    const s = start()
    const back = act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 800_004)
    const reply = act(guestSk, { type: 'move', n: 2, move: { cell: 0 } }, back, 800_004)
    const actions = [s, back, reply]
    expect(replay(ticTacToe, host, actions, at(800_006))).toMatchObject({ strikes: [1, 0], pendingStrikes: 0, nextStrikeAt: 800_007 })
    expect(replay(ticTacToe, host, actions, at(800_007))).toMatchObject({ pendingStrikes: 1, nextStrikeAt: 800_010, outcome: null })
    expect(replay(ticTacToe, host, actions, at(800_009)).outcome).toBeNull()
    expect(replay(ticTacToe, host, actions, at(800_010)).outcome).toEqual({ winner: 1, reason: 'strikes' })
  })

  it("a move that would come with a third strike doesn't count: the player had already lost", () => {
    const s = start()
    const tooLate = act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 800_009)
    const r = replay(ticTacToe, host, [s, tooLate], at(800_009))
    expect(r.steps).toHaveLength(1)
    expect(r.outcome).toEqual({ winner: 1, reason: 'strikes' })
  })

  it('with 1 block per turn, strikes land on the next three blocks', () => {
    const actions = [start()]
    const one = (h: number) => replay(ticTacToe, host, actions, { blocks: 1, knownHeight: h, settledHeight: h })
    expect(one(800_000).pendingStrikes).toBe(0)
    expect(one(800_001).pendingStrikes).toBe(1)
    expect(one(800_002).pendingStrikes).toBe(2)
    expect(one(800_003).outcome).toEqual({ winner: 1, reason: 'strikes' })
  })

  it('waiting for an opponent never counts: the clock starts at the start action', () => {
    // The game was listed long before; the start action (host admitting the challenger) records 800,000.
    expect(replay(ticTacToe, host, [start()], at(800_002)).pendingStrikes).toBe(0)
  })

  it('a filed strike locks in: a move backdated to an older block cannot erase it', () => {
    const s = start()
    const strike = act(strangerSk, { type: 'strike', n: 1 }, s, 800_003) // anyone may file, even a spectator
    const backdated = act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 800_002)
    let r = replay(ticTacToe, host, [s, backdated, strike], at(800_004))
    expect(r.strikes).toEqual([1, 0])
    expect(r.tip?.id).toBe(strike.event.id)
    expect(r.turn).toBe(0) // still the struck player's turn

    // They move on top of the strike; the next strike would be at 800,003 + 3.
    const move = act(hostSk, { type: 'move', n: 2, move: { cell: 4 } }, strike, 800_004)
    r = replay(ticTacToe, host, [s, backdated, strike, move], at(800_004))
    expect(r.strikes).toEqual([1, 0])
    expect(r.steps).toHaveLength(3)
  })

  it('dots and boxes: a strike passes the turn, and pending strikes alternate', () => {
    const s = start()
    // Host idles past 800,003: strike, the turn passes to the guest, whose clock starts there.
    let r = replay(dotsAndBoxes, host, [s], at(800_003))
    expect(r).toMatchObject({ turn: 1, totalStrikes: [1, 0], strikesDue: [800_003], strikesDueFor: [0], nextStrikeAt: 800_006 })
    // Nobody moves: the guest's strike at 800,006 passes it back.
    r = replay(dotsAndBoxes, host, [s], at(800_006))
    expect(r).toMatchObject({ turn: 0, totalStrikes: [1, 1], strikesDueFor: [0, 1] })

    // Filed, the strike hands the move to the guest; the host's late move doesn't count.
    const strike = act(strangerSk, { type: 'strike', n: 1 }, s, 800_003)
    const lateHost = act(hostSk, { type: 'move', n: 1, move: { edge: 0 } }, s, 800_004)
    r = replay(dotsAndBoxes, host, [s, lateHost, strike], at(800_004))
    expect(r.tip?.id).toBe(strike.event.id)
    expect(r.turn).toBe(1)
    const guestMove = act(guestSk, { type: 'move', n: 2, move: { edge: 0 } }, strike, 800_004)
    r = replay(dotsAndBoxes, host, [s, strike, guestMove], at(800_004))
    expect(r).toMatchObject({ turn: 0, strikes: [1, 0] })
  })

  it('dots and boxes: a move after its strike block is too late even when unfiled', () => {
    const s = start()
    const late = act(hostSk, { type: 'move', n: 1, move: { edge: 0 } }, s, 800_003)
    const r = replay(dotsAndBoxes, host, [s, late], at(800_003))
    expect(r.steps).toHaveLength(1)
    expect(r).toMatchObject({ turn: 1, totalStrikes: [1, 0] })
  })

  it('each replay step records the strikes so far, so a replay shows when they landed', () => {
    const s = start()
    const strike = act(strangerSk, { type: 'strike', n: 1 }, s, 800_003)
    const move = act(hostSk, { type: 'move', n: 2, move: { cell: 4 } }, strike, 800_004)
    const r = replay(ticTacToe, host, [s, strike, move], at(800_004))
    expect(r.steps.map((step) => step.strikes)).toEqual([[0, 0], [1, 0], [1, 0]])
  })

  it('after a filed strike at block c, the next lands at c + S', () => {
    const s = start()
    const strike = act(strangerSk, { type: 'strike', n: 1 }, s, 800_003)
    expect(replay(ticTacToe, host, [s, strike], at(800_005))).toMatchObject({ pendingStrikes: 0, nextStrikeAt: 800_006 })
    expect(replay(ticTacToe, host, [s, strike], at(800_006))).toMatchObject({ pendingStrikes: 1, strikesDue: [800_006] })
  })

  it('a strike must record exactly the block it landed on', () => {
    const s = start()
    for (const wrong of [800_002, 800_004]) {
      const r = replay(ticTacToe, host, [s, act(strangerSk, { type: 'strike', n: 1 }, s, wrong)], at(800_004))
      expect(r.steps).toHaveLength(1)
    }
  })

  it('ignores actions recording a block not mined yet, or older than the previous action', () => {
    const s = start()
    const future = act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 800_002)
    expect(replay(ticTacToe, host, [s, future], at(800_001)).steps).toHaveLength(1)
    expect(replay(ticTacToe, host, [s, future], at(800_002)).steps).toHaveLength(2)
    const older = act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 799_999)
    expect(replay(ticTacToe, host, [s, older], at(800_002)).steps).toHaveLength(1)
  })

  it('a strike only counts once its block is settled (the grace period)', () => {
    const r = replay(ticTacToe, host, [start()], at(800_003, 800_002))
    expect(r.pendingStrikes).toBe(0)
  })

  it('games without a clock never strike', () => {
    const r = replay(ticTacToe, host, play([4]), { blocks: null, knownHeight: 900_000 })
    expect(r).toMatchObject({ pendingStrikes: 0, nextStrikeAt: null, outcome: null })
  })
})
