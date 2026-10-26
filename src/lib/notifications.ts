import type { GameListing } from './nostr/gameEvents'
import type { ChatMessage } from './nostr/chat'
import type { ReplayResult } from './replay'

export type NoticeKind = 'invited' | 'joined' | 'turn' | 'strikeSoon' | 'strike' | 'ended' | 'chat'

export interface Notice {
  /** Stable, so the same event never notifies twice (even after a reload). */
  id: string
  kind: NoticeKind
  coordinate: string
  /** When it happened (unix seconds). */
  at: number
  /** Someone else involved: who invited, joined, struck out, or wrote. */
  actor?: string
  /** Kind-specific detail: strike count, chat text, how the game ended. */
  detail?: string
  /** Strikes: whether they landed on me. Ended: 'won' | 'lost' | 'draw'. */
  mine?: boolean
}

/** Kinds that stop mattering once the moment passes (it's no longer your turn). */
export const TRANSIENT: NoticeKind[] = ['turn', 'strikeSoon']

export interface GameView {
  listing: GameListing
  result: ReplayResult | null
  me: string
  /** Current Bitcoin block height, for "1 block left" warnings. */
  height: number | null
  chat: ChatMessage[]
}

/** Everything a game currently warrants telling `me` about. */
export function noticesFor({ listing, result, me, height, chat }: GameView): Notice[] {
  const c = listing.coordinate
  const notices: Notice[] = []

  if (listing.status === 'open' && listing.access === 'invite' && listing.host !== me && listing.pubkeys.includes(me) && !result?.started) {
    notices.push({ id: `${c}:invited`, kind: 'invited', coordinate: c, at: listing.createdAt, actor: listing.host })
  }
  if (!result?.started) return notices

  const myIndex = result.players.indexOf(me)
  if (myIndex < 0) return notices
  const opponent = result.players.find((p) => p !== me)
  const start = result.steps[0].action.event

  if (listing.host === me) notices.push({ id: `${c}:joined`, kind: 'joined', coordinate: c, at: start.created_at, actor: opponent })

  // Strikes, mine and my opponent's (filed or still pending).
  result.players.forEach((p, i) => {
    const total = result.totalStrikes[i]
    for (let n = 1; n <= total; n++) {
      notices.push({ id: `${c}:strike:${p}:${n}`, kind: 'strike', coordinate: c, at: result.tip!.createdAt, actor: p, detail: String(n), mine: p === me })
    }
  })

  if (result.outcome) {
    const o = result.outcome
    const how = 'draw' in o ? 'draw' : o.winner === myIndex ? 'won' : 'lost'
    notices.push({ id: `${c}:ended`, kind: 'ended', coordinate: c, at: result.tip!.createdAt, actor: opponent, detail: how })
  } else if (result.turn === myIndex && result.tip) {
    const tip = result.tip
    notices.push({ id: `${c}:turn:${tip.id}`, kind: 'turn', coordinate: c, at: tip.createdAt, actor: opponent })
    // One block from a strike: the last chance to move in time.
    if (result.nextStrikeAt !== null && height !== null && result.nextStrikeAt - height === 1) {
      notices.push({ id: `${c}:soon:${result.nextStrikeAt}`, kind: 'strikeSoon', coordinate: c, at: tip.createdAt })
    }
  }

  for (const m of chat) {
    if (m.author !== me) notices.push({ id: `chat:${m.id}`, kind: 'chat', coordinate: c, at: m.createdAt, actor: m.author, detail: m.text })
  }
  return notices
}
