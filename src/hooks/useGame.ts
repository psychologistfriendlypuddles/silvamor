import { useCallback, useEffect, useMemo, useState } from 'react'
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools/pure'
import { pool, publishTo } from '../lib/nostr/pool'
import {
  GAME_ACTION_KIND,
  GAME_JOIN_KIND,
  GAME_LISTING_KIND,
  buildAction,
  buildJoin,
  parseAction,
  parseListing,
  updateListing,
  type ActionContent,
  type GameListing,
} from '../lib/nostr/gameEvents'
import { inviteKey, makeJoinProof } from '../lib/gameCrypto'
import { replay, type ReplayResult } from '../lib/replay'
import { COMMENT_KIND, buildChatMessage, chatMessages } from '../lib/nostr/chat'
import { rulesFor } from '../games/registry'
import { useSession } from '../stores/session'
import { useLobby } from '../stores/lobby'
import { useRatings } from '../stores/ratings'
import { FEATURES } from '../features'
import { useNotifications } from '../stores/notifications'
import { settledHeight, useBlocks } from '../stores/blocks'
import { gameReadRelays, gameWriteRelays } from '../stores/relays'

/** Signs filed strikes (docs/PROTOCOL.md, "Turn clock"). One per session; it proves nothing about anyone. */
const STRIKE_FILER_KEY = generateSecretKey()

export interface GameAddress {
  host: string
  id: string
  relays?: string[]
}

export function useGame(address: GameAddress) {
  const { pubkey, signer } = useSession()
  const coordinate = `${GAME_LISTING_KIND}:${address.host}:${address.id}`
  const lobbyListing = useLobby((s) => s.listings[coordinate])
  const [listingEvent, setListingEvent] = useState<Event | null>(null)
  const [actionEvents, setActionEvents] = useState<Record<string, Event>>({})
  const [joins, setJoins] = useState<Event[]>([])
  const [notFound, setNotFound] = useState(false)
  const relayHints = address.relays

  const addAction = useCallback((e: Event) => setActionEvents((prev) => (prev[e.id] ? prev : { ...prev, [e.id]: e })), [])
  const addJoin = useCallback((e: Event) => setJoins((prev) => (prev.some((j) => j.id === e.id) ? prev : [...prev, e])), [])
  const [chatEvents, setChatEvents] = useState<Record<string, Event>>({})
  const addChat = useCallback((e: Event) => setChatEvents((prev) => (prev[e.id] ? prev : { ...prev, [e.id]: e })), [])
  const addListing = useCallback((e: Event) => {
    setListingEvent((prev) => (prev && prev.created_at >= e.created_at ? prev : e))
    useLobby.getState().add(e)
  }, [])

  useEffect(() => {
    const relays = gameReadRelays(relayHints)
    let gotListing = false
    const subs = [
      pool.subscribe(relays, { kinds: [GAME_LISTING_KIND], authors: [address.host], '#d': [address.id] }, {
        onevent: (e) => {
          gotListing = true
          addListing(e)
        },
      }),
      pool.subscribe(relays, { kinds: [GAME_ACTION_KIND], '#a': [coordinate] }, { onevent: addAction }),
      pool.subscribe(relays, { kinds: [GAME_JOIN_KIND], '#a': [coordinate] }, { onevent: addJoin }),
      pool.subscribe(relays, { kinds: [COMMENT_KIND], '#A': [coordinate] }, { onevent: addChat }),
    ]
    const timeout = setTimeout(() => !gotListing && setNotFound(true), 8000)
    return () => {
      clearTimeout(timeout)
      subs.forEach((s) => s.close())
    }
  }, [address.host, address.id, coordinate, relayHints, addAction, addJoin, addListing, addChat])

  // Prefer whichever copy of the listing is newest: from our subscription or the lobby (e.g. just updated by the host agent).
  const listing: GameListing | null = useMemo(() => {
    const own = listingEvent ? parseListing(listingEvent) : null
    if (!own) return lobbyListing ?? null
    if (!lobbyListing) return own
    return lobbyListing.createdAt > own.createdAt ? lobbyListing : own
  }, [listingEvent, lobbyListing])

  // The turn clock runs on Bitcoin block height. Re-check every few seconds so a
  // block's grace period ending (and with it, a strike) shows up by itself.
  const blocks = listing?.blocks ?? null
  const height = useBlocks((s) => s.height)
  const seenAt = useBlocks((s) => s.seenAt)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const settled = settledHeight(height, seenAt, nowMs)

  const rules = listing ? rulesFor(listing.game, listing.options) : undefined

  const result: ReplayResult | null = useMemo(() => {
    if (!listing || !rules) return null
    const actions = Object.values(actionEvents).map((e) => parseAction(e))
    return replay(rules, listing.host, actions, { blocks, knownHeight: height, settledHeight: settled })
  }, [listing, rules, actionEvents, blocks, height, settled])

  const myIndex = result && pubkey ? result.players.indexOf(pubkey) : -1
  const isHost = !!pubkey && pubkey === address.host
  const myJoin = joins.find((j) => j.pubkey === pubkey)
  const invited = listing?.access !== 'invite' || (!!pubkey && listing.pubkeys.includes(pubkey))

  const publish = useCallback(
    async (template: Parameters<NonNullable<typeof signer>['signEvent']>[0]) => {
      if (!signer) throw new Error('Not signed in.')
      const event = await signer.signEvent(template)
      await publishTo(gameWriteRelays(relayHints), event)
      return event
    },
    [signer, relayHints],
  )

  // The host of a link game can always recover the invite token from the listing,
  // on any of their devices, because it's encrypted to their own key.
  const [hostToken, setHostToken] = useState<string | null>(null)
  const encryptedInvite = isHost && listing?.access === 'link' ? listing.invite : undefined
  useEffect(() => {
    if (!encryptedInvite || !signer || !pubkey) return
    signer.nip44Decrypt(pubkey, encryptedInvite).then(setHostToken, () => setHostToken(null))
  }, [encryptedInvite, signer, pubkey])

  /** Joins; link games need the token from the invite link. */
  const join = useCallback(
    async (token?: string | null) => {
      if (!listing || !pubkey) return
      let proof = ''
      if (listing.access === 'link') {
        if (!token) throw new Error('You need the invite link to join this game.')
        proof = makeJoinProof(pubkey, await inviteKey(token))
      }
      addJoin(await publish(buildJoin(listing, proof)))
    },
    [listing, pubkey, publish, addJoin],
  )

  /** Files strikes that are due on top of `from`; returns the new tip. */
  const fileStrikes = useCallback(
    async (from: NonNullable<ReplayResult['tip']>, due: number[], dueFor: number[]) => {
      if (!listing || !result) return from
      let prev = from
      for (const [i, block] of due.entries()) {
        // Strikes are valid from any author, so sign with a throwaway key: no signer prompts.
        const event = finalizeEvent(
          buildAction(listing, { type: 'strike', n: prev.n + 1 }, { prev: prev.id, prevCreatedAt: prev.createdAt, others: [result.players[dueFor[i]]], block }),
          STRIKE_FILER_KEY,
        )
        addAction(event)
        await publishTo(gameWriteRelays(relayHints), event)
        prev = { id: event.id, createdAt: event.created_at, n: prev.n + 1, block }
      }
      return prev
    },
    [listing, result, addAction, relayHints],
  )

  const act = useCallback(
    async (content: Omit<ActionContent, 'n'> & Record<string, unknown>) => {
      if (!listing || !result?.tip || !pubkey) return
      const others = result.players.filter((p) => p !== pubkey)
      const block = useBlocks.getState().height
      if (listing.blocks && block === null) throw new Error("Can't reach the Bitcoin block height right now. Try again in a moment.")
      // A strike that passed the turn to us must be on record before our move can follow it.
      const tip = await fileStrikes(result.tip, result.strikesDue, result.strikesDueFor)
      const template = buildAction(listing, { ...content, n: tip.n + 1 } as ActionContent, {
        prev: tip.id,
        prevCreatedAt: tip.createdAt,
        others,
        block,
      })
      if (!signer) throw new Error('Not signed in.')
      const event = await signer.signEvent(template)
      addAction(event) // show it right away; relays confirm in the background
      await publishTo(gameWriteRelays(relayHints), event)
    },
    [listing, result, pubkey, signer, addAction, relayHints, fileStrikes],
  )

  const move = useCallback((m: unknown) => act({ type: 'move', move: m }), [act])

  // Chat between the players (spectators neither see nor send).
  const gamePlayers = result?.players
  const chat = useMemo(
    () => (gamePlayers ? chatMessages(Object.values(chatEvents), coordinate, gamePlayers) : []),
    [chatEvents, coordinate, gamePlayers],
  )
  const sendChat = useCallback(
    async (text: string) => {
      if (!listing || !gamePlayers || !pubkey || !text.trim()) return
      const event = await publish(buildChatMessage(listing, text, gamePlayers, pubkey))
      addChat(event)
    },
    [listing, gamePlayers, pubkey, publish, addChat],
  )
  const resign = useCallback(() => act({ type: 'resign' }), [act])

  const cancel = useCallback(async () => {
    if (!listing || !isHost) return
    addListing(await publish(updateListing(listing, { status: 'cancelled' })))
  }, [listing, isHost, publish, addListing])

  // Option B: once strikes are due, any client watching (player or spectator) files them,
  // so a late move backdated to an older block can't erase them. The waiting opponent
  // files first; everyone else (the struck player, spectators) waits longer and stands
  // down if that strike arrives meanwhile, so the same strike is rarely filed twice.
  const due = result?.strikesDue.join(',') ?? ''
  const dueTip = result?.tip
  useEffect(() => {
    if (!due || !dueTip || !listing || !result) return
    const struck = result.players[result.strikesDueFor[0]]
    const t = setTimeout(
      () => {
        // On failure someone else will file it, or we'll retry on the next change.
        fileStrikes(dueTip, result.strikesDue, result.strikesDueFor).catch(() => {})
      },
      pubkey && pubkey !== struck && result.players.includes(pubkey) ? Math.random() * 3000 : 10_000 + Math.random() * 10_000,
    )
    return () => clearTimeout(t)
    // Re-run only when the due strikes or the tip change, not on every replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, dueTip?.id])

  // Looking at the game is reading its notifications (including ones that arrive meanwhile).
  const unreadHere = useNotifications((s) => s.items.some((n) => n.coordinate === coordinate && !n.read))
  useEffect(() => {
    if (unreadHere) useNotifications.getState().markGameRead(coordinate)
  }, [unreadHere, coordinate])

  // Ratings cached before this game ended are stale now.
  const ended = !!result?.outcome
  const players = result?.players.join(',')
  useEffect(() => {
    if (FEATURES.ratings && ended && players) players.split(',').forEach((p) => useRatings.getState().fetch(p, true))
  }, [ended, players])

  // The host's client marks the listing finished so the lobby moves it out of "live".
  useEffect(() => {
    if (!isHost || !listing || !result?.outcome || listing.status === 'finished') return
    publish(updateListing(listing, { status: 'finished' })).then(addListing, () => {})
  }, [isHost, listing, result?.outcome, publish, addListing])

  return {
    coordinate,
    listing,
    rules,
    result,
    notFound: notFound && !listing,
    /** Host only: the token for this link game's invite link. */
    hostToken,
    myIndex,
    isHost,
    isPlayer: myIndex >= 0,
    myTurn: myIndex >= 0 && result?.turn === myIndex,
    /** Clocked games need a block height before anyone can act. */
    waitingForBlocks: !!blocks && height === null,
    /** Current Bitcoin block height, for the turn clock display. */
    height,
    hasJoined: !!myJoin,
    invited,
    joins,
    join,
    chat,
    sendChat,
    move,
    resign,
    cancel,
  }
}
