import type { Event, EventTemplate } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { parseWager } from '../wager'
import { getRules } from '../../games/registry'

// See docs/PROTOCOL.md for the full specification.
export const GAME_LISTING_KIND = 30950
export const GAME_JOIN_KIND = 1950
export const GAME_ACTION_KIND = 1951
export const GAME_TAG = 'silvamor'

export type GameStatus = 'open' | 'active' | 'finished' | 'cancelled'
/** open: anyone · invite: listed npubs · link: whoever redeems the single-use invite link first */
export type GameAccess = 'open' | 'invite' | 'link'

export interface GameListing {
  event: Event
  coordinate: string
  id: string
  host: string
  game: string
  status: GameStatus
  access: GameAccess
  /** Bitcoin blocks per turn before a strike (docs/PROTOCOL.md, "Turn clock"), or null for no clock. */
  blocks: number | null
  /** Invitees before the game starts, players after. */
  pubkeys: string[]
  startId?: string
  title?: string
  /** Link games: the invite token, NIP-44 encrypted to the host so any of their devices can share the link. */
  invite?: string
  /** Game variant, from `["option", key, value]` tags (e.g. size → "8" for dots and boxes). */
  options: Record<string, string>
  /** Friendly wager in sats (honor system: the loser zaps the winner), or null. */
  wager: number | null
  createdAt: number
}

export type ActionContent =
  | { type: 'start'; n: 0; players: string[] }
  | { type: 'move'; n: number; move: unknown }
  | { type: 'resign'; n: number }
  | { type: 'strike'; n: number }

export interface GameAction {
  event: Event
  prev?: string
  /** Bitcoin block height the action was made at (`block` tag). */
  block?: number
  content: ActionContent | null // null = couldn't parse
}

const now = () => Math.floor(Date.now() / 1000)
const tag = (event: Event, name: string) => event.tags.find((t) => t[0] === name)?.[1]

export const coordinateOf = (host: string, id: string) => `${GAME_LISTING_KIND}:${host}:${id}`

export function newGameId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)))
}

function parsePositiveInt(value: string | undefined): number | null {
  const n = Number(value)
  return value !== undefined && Number.isSafeInteger(n) && n > 0 ? n : null
}

export function parseListing(event: Event): GameListing | null {
  const id = tag(event, 'd')
  const game = tag(event, 'game')
  if (event.kind !== GAME_LISTING_KIND || !id || !game) return null
  let content: { title?: unknown; invite?: unknown } = {}
  try {
    content = JSON.parse(event.content || '{}')
  } catch {
    /* tolerate */
  }
  const oneOf = <T extends string>(value: string | undefined, options: readonly T[], fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback
  const access = tag(event, 'access') ?? 'open'
  // Skip listings with an access mode we don't know (e.g. the retired "password").
  if (!['open', 'invite', 'link'].includes(access)) return null
  return {
    event,
    coordinate: coordinateOf(event.pubkey, id),
    id,
    host: event.pubkey,
    game,
    status: oneOf(tag(event, 'status'), ['open', 'active', 'finished', 'cancelled'] as const, 'open'),
    access: access as GameAccess,
    blocks: parsePositiveInt(tag(event, 'blocks')),
    pubkeys: event.tags.filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? '')).map((t) => t[1]),
    startId: tag(event, 'e'),
    title: typeof content.title === 'string' ? content.title.slice(0, 80) : undefined,
    invite: typeof content.invite === 'string' ? content.invite : undefined,
    wager: parseWager(tag(event, 'wager')),
    options: Object.fromEntries(event.tags.filter((t) => t[0] === 'option' && t[1] && t[2] !== undefined).map((t) => [t[1], t[2]])),
    createdAt: event.created_at,
  }
}

export interface ListingFields {
  id: string
  game: string
  status: GameStatus
  access: GameAccess
  blocks: number | null
  pubkeys: string[]
  startId?: string
  title?: string
  invite?: string
  options?: Record<string, string>
  wager?: number | null
}

export function buildListing(f: ListingFields): EventTemplate {
  const name = getRules(f.game)?.name ?? f.game
  const tags = [
    ['d', f.id],
    ['t', GAME_TAG],
    ['game', f.game],
    ['status', f.status],
    ['access', f.access],
    ...f.pubkeys.map((p) => ['p', p]),
    ['alt', `${name} game on Silvamor`],
  ]
  if (f.blocks) tags.push(['blocks', String(f.blocks)])
  if (f.startId) tags.push(['e', f.startId])
  const content: Record<string, string> = {}
  if (f.title) content.title = f.title
  if (f.invite) content.invite = f.invite
  for (const [key, value] of Object.entries(f.options ?? {})) tags.push(['option', key, value])
  if (f.wager) tags.push(['wager', String(f.wager)])
  return { kind: GAME_LISTING_KIND, created_at: now(), tags, content: JSON.stringify(content) }
}

/** Rebuild a listing with some fields changed, e.g. status. */
export function updateListing(listing: GameListing, changes: Partial<ListingFields>): EventTemplate {
  const { id, game, status, access, blocks, pubkeys, startId, title, invite, options, wager } = listing
  return buildListing({ id, game, status, access, blocks, pubkeys, startId, title, invite, options, wager, ...changes })
}

export function buildJoin(listing: GameListing, proof = ''): EventTemplate {
  return {
    kind: GAME_JOIN_KIND,
    created_at: now(),
    content: proof,
    tags: [
      ['a', listing.coordinate],
      ['p', listing.host],
      // Joining a wager game means agreeing to its stake: the joiner signs the amount.
      ...(listing.wager ? [['wager', String(listing.wager)]] : []),
    ],
  }
}

export function buildAction(
  listing: GameListing,
  content: ActionContent,
  opts: { prev?: string; others: string[]; prevCreatedAt?: number; block?: number | null },
): EventTemplate {
  const tags = [['a', listing.coordinate]]
  if (opts.prev) tags.push(['e', opts.prev])
  if (opts.block != null) tags.push(['block', String(opts.block)])
  opts.others.forEach((p) => tags.push(['p', p]))
  // Keep the chain's timestamps non-decreasing even if clocks disagree a little.
  const createdAt = Math.max(now(), opts.prevCreatedAt ?? 0)
  return { kind: GAME_ACTION_KIND, created_at: createdAt, tags, content: JSON.stringify(content) }
}

export function parseAction(event: Event): GameAction {
  let content: ActionContent | null = null
  try {
    const parsed = JSON.parse(event.content)
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string' && Number.isInteger(parsed.n)) {
      content = parsed
    }
  } catch {
    /* not a Silvamor action */
  }
  const block = parsePositiveInt(tag(event, 'block')) ?? undefined
  return { event, prev: tag(event, 'e'), block, content }
}
