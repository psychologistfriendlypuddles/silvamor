import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { pool } from '../lib/nostr/pool'
import { GAME_ACTION_KIND, GAME_LISTING_KIND, parseAction, parseListing, type GameListing } from '../lib/nostr/gameEvents'
import { replay } from '../lib/replay'
import { computeRecord, type FinishedGame, type PlayerRecord } from '../lib/ratings'
import { rulesFor } from '../games/registry'
import { gameReadRelays } from './relays'
import { useBlocks } from './blocks'

const STALE_AFTER = 5 * 60 * 1000

interface RatingsState {
  records: Record<string, { record: PlayerRecord; fetchedAt: number }>
  pending: Record<string, boolean>
  fetch(pubkey: string, force?: boolean): Promise<void>
}

/**
 * Every client computes ratings itself from games it can replay, so nobody can
 * hand out (or fake) scores.
 */
async function loadFinishedGames(pubkey: string): Promise<FinishedGame[]> {
  const relays = gameReadRelays()
  const listingEvents = await pool.querySync(relays, { kinds: [GAME_LISTING_KIND], '#p': [pubkey], limit: 500 }, { maxWait: 5000 })

  const listings = new Map<string, GameListing>()
  for (const event of listingEvents) {
    const l = parseListing(event)
    if (!l || !l.startId || !rulesFor(l.game, l.options) || !l.pubkeys.includes(pubkey)) continue
    const existing = listings.get(l.coordinate)
    if (!existing || existing.createdAt < l.createdAt) listings.set(l.coordinate, l)
  }
  const replayable = [...listings.values()]
  if (replayable.length === 0) return []

  const actionsByGame = new Map<string, Event[]>()
  const coords = replayable.map((l) => l.coordinate)
  for (let i = 0; i < coords.length; i += 100) {
    const events = await pool.querySync(relays, { kinds: [GAME_ACTION_KIND], '#a': coords.slice(i, i + 100) }, { maxWait: 5000 })
    for (const e of events) {
      const a = e.tags.find((t) => t[0] === 'a')?.[1]
      if (a) actionsByGame.set(a, [...(actionsByGame.get(a) ?? []), e])
    }
  }

  const finished: FinishedGame[] = []
  for (const l of replayable) {
    const actions = (actionsByGame.get(l.coordinate) ?? []).map((e) => parseAction(e))
    const result = replay(rulesFor(l.game, l.options)!, l.host, actions, { blocks: l.blocks, knownHeight: useBlocks.getState().height })
    if (result.started && result.outcome) finished.push({ coordinate: l.coordinate, players: result.players, outcome: result.outcome })
  }
  return finished
}

export const useRatings = create<RatingsState>((set, get) => ({
  records: {},
  pending: {},
  async fetch(pubkey, force = false) {
    const cached = get().records[pubkey]
    if (get().pending[pubkey] || (!force && cached && Date.now() - cached.fetchedAt < STALE_AFTER)) return
    set({ pending: { ...get().pending, [pubkey]: true } })
    try {
      const record = computeRecord(pubkey, await loadFinishedGames(pubkey))
      set({ records: { ...get().records, [pubkey]: { record, fetchedAt: Date.now() } } })
    } finally {
      set({ pending: { ...get().pending, [pubkey]: false } })
    }
  },
}))
