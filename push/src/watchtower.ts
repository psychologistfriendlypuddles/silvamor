import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { GAME_ACTION_KIND, GAME_LISTING_KIND, parseAction, parseListing, type GameListing } from '../../src/lib/nostr/gameEvents'
import { COMMENT_KIND, chatMessages } from '../../src/lib/nostr/chat'
import { replay } from '../../src/lib/replay'
import { noticesFor, type Notice } from '../../src/lib/notifications'
import { noticeText } from '../../src/lib/noticeText'
import { displayName, parseProfile, type ProfileContent } from '../../src/lib/nostr/profile'
import { gamePath } from '../../src/lib/paths'
import { rulesFor } from '../../src/games/registry'
import { settledHeight } from '../../src/stores/blocks'
import type { PushSubscriptionData, Store } from './store'

// The same rules the app uses decide what's worth a notification (src/lib/notifications.ts),
// so the app and this service can't disagree.

export interface PushPayload {
  title: string
  body: string
  /** Opened when the notification is tapped. */
  url: string
  /** Replaces an earlier notification about the same game. */
  tag: string
}

export type SendResult = 'ok' | 'gone' | 'error'

export interface WatchtowerOptions {
  relays: string[]
  store: Store
  /** Delivers one push. 'gone' means the subscription expired and is removed. */
  send(sub: PushSubscriptionData, payload: PushPayload): Promise<SendResult>
  /** Current Bitcoin block height (for turn clocks), or null if unknown. */
  getHeight(): Promise<number | null>
  /** Where the app lives, e.g. https://www.silvamor.com, for links in notifications. */
  appUrl: string
  log?: (message: string) => void
}

/** Finished games stay watched this long, so "you won / lost" still goes out. */
const RECENT_SECONDS = 2 * 24 * 3600
const HEIGHT_POLL_MS = 30_000
/** Strike grace periods end with time, not events. */
const REEVALUATE_MS = 15_000

export function createWatchtower(opts: WatchtowerOptions) {
  const log = opts.log ?? (() => {})
  const pool = new SimplePool({ enableReconnect: true })
  const listings = new Map<string, GameListing>()
  const events = new Map<string, Map<string, Event>>()
  const profiles = new Map<string, ProfileContent>()
  let height: number | null = null
  const seenAt: Record<number, number> = {}
  let listingSubs: { close(): void }[] = []
  let gameSubs: { close(): void }[] = []
  let gameSubsKey = ''
  let evaluateTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const addListing = (e: Event) => {
    const l = parseListing(e)
    if (!l) return
    const existing = listings.get(l.coordinate)
    if (existing && existing.createdAt >= l.createdAt) return
    listings.set(l.coordinate, l)
    resubscribeGames()
    scheduleEvaluate()
  }

  const addGameEvent = (coordinate: string | undefined, e: Event) => {
    if (!coordinate) return
    const forGame = events.get(coordinate) ?? new Map()
    if (forGame.has(e.id)) return
    forGame.set(e.id, e)
    events.set(coordinate, forGame)
    scheduleEvaluate()
  }

  const isWatched = (l: GameListing, pubkey: string, now: number) =>
    (l.host === pubkey || l.pubkeys.includes(pubkey)) &&
    (l.status === 'open' || l.status === 'active' || (l.status === 'finished' && l.createdAt > now - RECENT_SECONDS))

  /** Follows listings (as host, invitee or player) for everyone subscribed. */
  function resubscribeListings() {
    listingSubs.forEach((s) => s.close())
    const pubkeys = opts.store.pubkeys()
    if (pubkeys.length === 0) return (listingSubs = [])
    listingSubs = [
      pool.subscribe(opts.relays, { kinds: [GAME_LISTING_KIND], '#p': pubkeys }, { onevent: addListing }),
      pool.subscribe(opts.relays, { kinds: [GAME_LISTING_KIND], authors: pubkeys }, { onevent: addListing }),
    ]
  }

  /** Follows moves and chat in every watched game. */
  function resubscribeGames() {
    const now = Math.floor(Date.now() / 1000)
    const pubkeys = opts.store.pubkeys()
    const coords = [...listings.values()]
      .filter((l) => pubkeys.some((p) => isWatched(l, p, now)))
      .map((l) => l.coordinate)
      .sort()
    const key = coords.join(',')
    if (key === gameSubsKey) return
    gameSubsKey = key
    gameSubs.forEach((s) => s.close())
    gameSubs = []
    for (let i = 0; i < coords.length; i += 100) {
      const chunk = coords.slice(i, i + 100)
      gameSubs.push(
        pool.subscribe(opts.relays, { kinds: [GAME_ACTION_KIND], '#a': chunk }, { onevent: (e) => addGameEvent(e.tags.find((t) => t[0] === 'a')?.[1], e) }),
        pool.subscribe(opts.relays, { kinds: [COMMENT_KIND], '#A': chunk }, { onevent: (e) => addGameEvent(e.tags.find((t) => t[0] === 'A')?.[1], e) }),
      )
    }
  }

  function scheduleEvaluate(delay = 500) {
    clearTimeout(evaluateTimer)
    evaluateTimer = setTimeout(() => void evaluate(), delay)
  }

  /** What each subscriber's games currently warrant (same rules as the app). */
  function currentNotices(pubkey: string): { notice: Notice; listing: GameListing }[] {
    const now = Math.floor(Date.now() / 1000)
    const settled = settledHeight(height, seenAt, Date.now())
    const out: { notice: Notice; listing: GameListing }[] = []
    for (const listing of listings.values()) {
      if (!isWatched(listing, pubkey, now)) continue
      const rules = rulesFor(listing.game, listing.options)
      if (!rules) continue
      const all = [...(events.get(listing.coordinate)?.values() ?? [])]
      const result = replay(
        rules,
        listing.host,
        all.filter((e) => e.kind === GAME_ACTION_KIND).map((e) => parseAction(e)),
        { blocks: listing.blocks, knownHeight: height, settledHeight: settled },
      )
      const chat = result.started ? chatMessages(all, listing.coordinate, result.players) : []
      for (const notice of noticesFor({ listing, result, me: pubkey, height, chat })) out.push({ notice, listing })
    }
    return out
  }

  async function evaluate() {
    if (closed) return
    for (const pubkey of opts.store.pubkeys()) {
      const fresh = currentNotices(pubkey).filter(({ notice }) => !opts.store.wasSent(pubkey, notice.id))
      if (fresh.length === 0) continue
      await loadProfiles(fresh.map(({ notice }) => notice.actor).filter((a): a is string => !!a))
      for (const { notice, listing } of fresh) {
        opts.store.markSent(pubkey, [notice.id]) // first, so a slow push can't go out twice
        await deliver(pubkey, toPayload(notice, listing))
      }
    }
  }

  async function deliver(pubkey: string, payload: PushPayload) {
    for (const sub of opts.store.subscriptionsFor(pubkey)) {
      const result = await opts.send(sub, payload).catch((): SendResult => 'error')
      if (result === 'gone') opts.store.removeSubscription(sub.endpoint)
      log(`push ${result}: ${payload.body}`)
    }
  }

  function toPayload(notice: Notice, listing: GameListing): PushPayload {
    const name = notice.actor ? displayName(profiles.get(notice.actor), nip19.npubEncode(notice.actor)) : 'Someone'
    const title = listing.title || rulesFor(listing.game, listing.options)?.name || 'a game'
    const { emoji, text } = noticeText(notice, name, title)
    return { title: 'Silvamor', body: `${emoji} ${text}`, url: `${opts.appUrl}${gamePath(listing.host, listing.id)}`, tag: listing.coordinate }
  }

  async function loadProfiles(pubkeys: string[]) {
    const missing = [...new Set(pubkeys)].filter((p) => !profiles.has(p))
    if (missing.length === 0) return
    const found = await pool.querySync(opts.relays, { kinds: [0], authors: missing }, { maxWait: 3000 }).catch(() => [])
    for (const e of found.sort((a, b) => a.created_at - b.created_at)) profiles.set(e.pubkey, parseProfile(e))
  }

  async function pollHeight() {
    const h = await opts.getHeight().catch(() => null)
    if (h !== null && (height === null || h > height)) {
      seenAt[h] = height === null ? 0 : Date.now()
      height = h
      scheduleEvaluate()
    }
  }

  void pollHeight()
  const heightTimer = setInterval(() => void pollHeight(), HEIGHT_POLL_MS)
  const evaluateInterval = setInterval(() => scheduleEvaluate(0), REEVALUATE_MS)
  resubscribeListings()

  return {
    /**
     * Call after someone subscribes: marks everything their games already warrant as
     * sent (no flood of old news), then starts following their games.
     */
    async subscribed(pubkey: string) {
      const [asPlayer, asHost] = await Promise.all([
        pool.querySync(opts.relays, { kinds: [GAME_LISTING_KIND], '#p': [pubkey] }, { maxWait: 4000 }),
        pool.querySync(opts.relays, { kinds: [GAME_LISTING_KIND], authors: [pubkey] }, { maxWait: 4000 }),
      ])
      ;[...asPlayer, ...asHost].forEach(addListing)
      const coords = [...listings.values()].filter((l) => isWatched(l, pubkey, Math.floor(Date.now() / 1000))).map((l) => l.coordinate)
      if (coords.length > 0) {
        const gameEvents = await Promise.all([
          pool.querySync(opts.relays, { kinds: [GAME_ACTION_KIND], '#a': coords }, { maxWait: 4000 }),
          pool.querySync(opts.relays, { kinds: [COMMENT_KIND], '#A': coords }, { maxWait: 4000 }),
        ])
        gameEvents.flat().forEach((e) => addGameEvent(e.tags.find((t) => t[0] === 'a' || t[0] === 'A')?.[1], e))
      }
      opts.store.markSent(pubkey, currentNotices(pubkey).map(({ notice }) => notice.id))
      resubscribeListings()
      resubscribeGames()
    },
    /** Re-follow after someone unsubscribes. */
    unsubscribed() {
      resubscribeListings()
      resubscribeGames()
    },
    /** For tests: evaluate right away and wait for pushes to go out. */
    evaluateNow: () => evaluate(),
    close() {
      closed = true
      clearTimeout(evaluateTimer)
      clearInterval(heightTimer)
      clearInterval(evaluateInterval)
      listingSubs.forEach((s) => s.close())
      gameSubs.forEach((s) => s.close())
      pool.destroy()
    },
  }
}

export type Watchtower = ReturnType<typeof createWatchtower>
