import { useEffect, useMemo, useRef, useState } from 'react'
import type { Event } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { pool } from '../lib/nostr/pool'
import { GAME_ACTION_KIND, parseAction, type GameListing } from '../lib/nostr/gameEvents'
import { COMMENT_KIND, chatMessages } from '../lib/nostr/chat'
import { replay } from '../lib/replay'
import { noticesFor } from '../lib/notifications'
import { noticeText } from '../lib/noticeText'
import { displayName } from '../lib/nostr/profile'
import { gamePath, parseGamePath } from '../lib/paths'
import { rulesFor } from '../games/registry'
import { useSession } from '../stores/session'
import { useLobby } from '../stores/lobby'
import { settledHeight, useBlocks } from '../stores/blocks'
import { gameReadRelays } from '../stores/relays'
import { useNotifications } from '../stores/notifications'
import { useProfiles } from '../stores/profiles'
import { toast } from '../stores/toast'

/** Finished games stay watched this long, so "you won / lost" still arrives. */
const RECENT_SECONDS = 2 * 24 * 3600

/**
 * While the app is open, follows every game the user hosts, plays in or is invited
 * to, and turns what happens into notifications (Alerts page, badge, toasts).
 */
export function useGameWatcher() {
  const pubkey = useSession((s) => s.pubkey)
  const listings = useLobby((s) => s.listings)
  const height = useBlocks((s) => s.height)
  const seenAt = useBlocks((s) => s.seenAt)

  useEffect(() => {
    if (pubkey) useNotifications.getState().load(pubkey)
  }, [pubkey])

  const [cutoff] = useState(() => Math.floor(Date.now() / 1000) - RECENT_SECONDS)
  const mine = useMemo(
    () =>
      Object.values(listings).filter(
        (l) =>
          pubkey &&
          (l.host === pubkey || l.pubkeys.includes(pubkey)) &&
          (l.status === 'open' || l.status === 'active' || (l.status === 'finished' && l.createdAt > cutoff)),
      ),
    [listings, pubkey, cutoff],
  )
  const coordsKey = mine
    .map((l) => l.coordinate)
    .sort()
    .join(',')

  // Moves and chat for all those games, gathered per game.
  const events = useRef(new Map<string, Map<string, Event>>())
  const [version, setVersion] = useState(0)
  const [synced, setSynced] = useState(false)
  useEffect(() => {
    if (!coordsKey) return
    const coords = coordsKey.split(',')
    let pending = 0
    let bump: ReturnType<typeof setTimeout> | undefined
    const add = (coordinate: string | undefined, e: Event) => {
      if (!coordinate) return
      const forGame = events.current.get(coordinate) ?? new Map()
      if (forGame.has(e.id)) return
      forGame.set(e.id, e)
      events.current.set(coordinate, forGame)
      clearTimeout(bump)
      bump = setTimeout(() => setVersion((v) => v + 1), 250) // batch bursts of events
    }
    const done = () => --pending <= 0 && setSynced(true)
    const subs: { close(): void }[] = []
    for (let i = 0; i < coords.length; i += 100) {
      const chunk = coords.slice(i, i + 100)
      pending += 2
      subs.push(
        pool.subscribe(gameReadRelays(), { kinds: [GAME_ACTION_KIND], '#a': chunk }, {
          onevent: (e) => add(e.tags.find((t) => t[0] === 'a')?.[1], e),
          oneose: done,
        }),
        pool.subscribe(gameReadRelays(), { kinds: [COMMENT_KIND], '#A': chunk }, {
          onevent: (e) => add(e.tags.find((t) => t[0] === 'A')?.[1], e),
          oneose: done,
        }),
      )
    }
    const fallback = setTimeout(() => setSynced(true), 6000) // a silent relay mustn't block toasts forever
    return () => {
      clearTimeout(bump)
      clearTimeout(fallback)
      subs.forEach((s) => s.close())
    }
  }, [coordsKey])

  // Strike grace periods end with time, not events: re-check every 15 s.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!pubkey) return
    const settled = settledHeight(height, seenAt, Date.now())
    const store = useNotifications.getState()
    for (const listing of mine) {
      const fresh = store.merge(listing.coordinate, noticesForListing(listing, pubkey, height, settled, events.current.get(listing.coordinate)), titleOf(listing))
      if (synced) fresh.forEach(announce)
    }
    // `tick` re-runs this so strikes appear when a grace period ends.
  }, [mine, pubkey, height, seenAt, version, synced, tick])
}

function noticesForListing(listing: GameListing, me: string, height: number | null, settled: number | null, events: Map<string, Event> | undefined) {
  const rules = rulesFor(listing.game, listing.options)
  if (!rules) return []
  const all = [...(events?.values() ?? [])]
  const result = replay(
    rules,
    listing.host,
    all.filter((e) => e.kind === GAME_ACTION_KIND).map((e) => parseAction(e)),
    { blocks: listing.blocks, knownHeight: height, settledHeight: settled },
  )
  const chat = result.started ? chatMessages(all, listing.coordinate, result.players) : []
  return noticesFor({ listing, result, me, height, chat })
}

function titleOf(listing: GameListing) {
  return listing.title || rulesFor(listing.game, listing.options)?.name || 'a game'
}

/** A toast for a new notice, unless the user is looking at that game right now. */
async function announce(n: { coordinate: string; actor?: string; title: string } & Parameters<typeof noticeText>[0]) {
  const viewing = parseGamePath(location.pathname.match(/^\/game\/([^/]+)/)?.[1])
  if (viewing && `30950:${viewing.host}:${viewing.id}` === n.coordinate) return
  if (n.actor) await useProfiles.getState().fetch(n.actor).catch(() => {}) // say "Bob", not an npub
  const profile = n.actor ? useProfiles.getState().profiles[n.actor]?.content : undefined
  const name = n.actor ? displayName(profile, nip19.npubEncode(n.actor)) : 'Someone'
  const { emoji, text } = noticeText(n, name, n.title)
  const [, host, id] = n.coordinate.split(':')
  toast.info(`${emoji} ${text}`, gamePath(host, id)) // tapping it opens the game
}
