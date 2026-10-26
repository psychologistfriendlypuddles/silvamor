import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { pool } from '../lib/nostr/pool'
import { GAME_LISTING_KIND, GAME_TAG, parseListing, type GameListing } from '../lib/nostr/gameEvents'
import { gameReadRelays } from './relays'

const LOOKBACK = 14 * 24 * 3600

interface LobbyState {
  listings: Record<string, GameListing>
  loaded: boolean
  start(pubkey: string): () => void
  add(event: Event): void
}

export const useLobby = create<LobbyState>((set, get) => ({
  listings: {},
  loaded: false,

  add(event) {
    const listing = parseListing(event)
    if (!listing) return
    const existing = get().listings[listing.coordinate]
    if (existing && existing.createdAt >= listing.createdAt) return
    set({ listings: { ...get().listings, [listing.coordinate]: listing } })
  },

  /** Subscribes to public games, games I host, and games I'm invited to or playing. Returns a stop function. */
  start(pubkey) {
    const relays = gameReadRelays()
    const since = Math.floor(Date.now() / 1000) - LOOKBACK
    const filters = [
      { kinds: [GAME_LISTING_KIND], '#t': [GAME_TAG], since, limit: 300 },
      { kinds: [GAME_LISTING_KIND], authors: [pubkey], limit: 100 },
      { kinds: [GAME_LISTING_KIND], '#p': [pubkey], limit: 100 },
    ]
    let pendingEose = filters.length
    const closers = filters.map((filter) =>
      pool.subscribe(relays, filter, {
        onevent: get().add,
        oneose: () => {
          if (--pendingEose === 0) set({ loaded: true })
        },
      }),
    )
    // Don't spin forever if a relay never answers.
    const timeout = setTimeout(() => set({ loaded: true }), 5000)
    return () => {
      clearTimeout(timeout)
      closers.forEach((c) => c.close())
    }
  },
}))
