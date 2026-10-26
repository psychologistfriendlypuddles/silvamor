import * as nip19 from 'nostr-tools/nip19'
import { GAME_LISTING_KIND } from './nostr/gameEvents'
import type { GameAddress } from '../hooks/useGame'

/** Shareable route for a game: /game/naddr1… (relay hints included so others can find it). */
export function gamePath(host: string, id: string, relays: string[] = []) {
  return `/game/${nip19.naddrEncode({ kind: GAME_LISTING_KIND, pubkey: host, identifier: id, relays: relays.slice(0, 3) })}`
}

export function parseGamePath(naddr: string | undefined): GameAddress | null {
  if (!naddr) return null
  try {
    const decoded = nip19.decode(naddr)
    if (decoded.type !== 'naddr' || decoded.data.kind !== GAME_LISTING_KIND) return null
    return { host: decoded.data.pubkey, id: decoded.data.identifier, relays: decoded.data.relays }
  } catch {
    return null
  }
}
