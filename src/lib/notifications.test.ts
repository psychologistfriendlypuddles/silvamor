import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ticTacToe } from '../games/tictactoe/rules'
import { buildAction, buildListing, parseAction, parseListing, type ActionContent, type GameAction } from './nostr/gameEvents'
import { replay } from './replay'
import { noticesFor } from './notifications'

const hostSk = generateSecretKey()
const guestSk = generateSecretKey()
const host = getPublicKey(hostSk)
const guest = getPublicKey(guestSk)

const listing = (fields: Partial<Parameters<typeof buildListing>[0]> = {}) =>
  parseListing(
    finalizeEvent(buildListing({ id: 'g', game: 'tictactoe', status: 'active', access: 'open', blocks: 3, pubkeys: [host, guest], ...fields }), hostSk),
  )!

let clock = 1_700_000_000
function act(sk: Uint8Array, content: ActionContent, prev: GameAction | undefined, block: number) {
  const t = buildAction(listing(), content, { prev: prev?.event.id, others: [], block })
  t.created_at = clock++
  return parseAction(finalizeEvent(t, sk))
}
const start = () => act(hostSk, { type: 'start', n: 0, players: [host, guest] }, undefined, 800_000)
const view = (actions: GameAction[], me: string, height: number, l = listing()) => ({
  listing: l,
  result: replay(ticTacToe, host, actions, { blocks: 3, knownHeight: height, settledHeight: height }),
  me,
  height,
  chat: [],
})
const kinds = (v: ReturnType<typeof view>) => noticesFor(v).map((n) => n.kind)

describe('notifications', () => {
  it('tells the host someone joined, and the player on turn that it is their turn', () => {
    const actions = [start()]
    expect(kinds(view(actions, host, 800_000))).toEqual(['joined', 'turn'])
    expect(kinds(view(actions, guest, 800_000))).toEqual([]) // not their turn yet
  })

  it('each turn has its own id, so a new move notifies again', () => {
    const s = start()
    const move = act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, s, 800_001)
    const [turn] = noticesFor(view([s, move], guest, 800_001))
    expect(turn).toMatchObject({ kind: 'turn', id: `${listing().coordinate}:turn:${move.event.id}`, actor: host })
  })

  it('warns one block before a strike', () => {
    expect(kinds(view([start()], host, 800_001))).not.toContain('strikeSoon')
    expect(kinds(view([start()], host, 800_002))).toContain('strikeSoon') // strike lands at 800,003
  })

  it('reports strikes, on me and on my opponent', () => {
    const v = view([start()], host, 800_003)
    expect(noticesFor(v).filter((n) => n.kind === 'strike')).toMatchObject([{ mine: true, detail: '1' }])
    expect(noticesFor({ ...v, me: guest }).filter((n) => n.kind === 'strike')).toMatchObject([{ mine: false, actor: host }])
  })

  it('reports how the game ended, and stops saying it is your turn', () => {
    const v = view([start()], guest, 800_009) // host struck out
    expect(noticesFor(v).find((n) => n.kind === 'ended')).toMatchObject({ detail: 'won' })
    expect(kinds(v)).not.toContain('turn')
  })

  it('notifies invitations to open invite-only games', () => {
    const invite = listing({ status: 'open', access: 'invite', pubkeys: [guest] })
    expect(noticesFor({ listing: invite, result: null, me: guest, height: null, chat: [] })).toMatchObject([{ kind: 'invited', actor: host }])
  })

  it("notifies the opponent's chat messages, not my own", () => {
    const chat = [
      { id: 'a', author: host, text: 'gl hf', createdAt: 1, event: {} as never },
      { id: 'b', author: guest, text: 'you too', createdAt: 2, event: {} as never },
    ]
    const notices = noticesFor({ ...view([start()], guest, 800_000), chat }).filter((n) => n.kind === 'chat')
    expect(notices).toMatchObject([{ actor: host, detail: 'gl hf' }])
  })
})
