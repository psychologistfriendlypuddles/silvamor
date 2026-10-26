import type { Event, EventTemplate } from 'nostr-tools/pure'
import { GAME_LISTING_KIND, type GameListing } from './gameEvents'

// In-game chat: NIP-22 comments (kind 1111) on the game listing, so other Nostr apps
// can show the thread too. Only players' messages are shown (docs/PROTOCOL.md, "Chat").
export const COMMENT_KIND = 1111
export const MAX_CHAT_LENGTH = 280

export interface ChatMessage {
  id: string
  author: string
  text: string
  createdAt: number
  event: Event
}

export function buildChatMessage(listing: GameListing, text: string, players: string[], me: string): EventTemplate {
  const kind = String(GAME_LISTING_KIND)
  // Root and parent are both the listing (a top-level comment); p tags notify the other players.
  const mentions = [...new Set([listing.host, ...players])].filter((p) => p !== me)
  return {
    kind: COMMENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: text.trim().slice(0, MAX_CHAT_LENGTH),
    tags: [
      ['A', listing.coordinate],
      ['K', kind],
      ['P', listing.host],
      ['a', listing.coordinate],
      ['k', kind],
      ...mentions.map((p) => ['p', p]),
    ],
  }
}

/** Messages from the game's players only, oldest first. */
export function chatMessages(events: Event[], coordinate: string, players: string[]): ChatMessage[] {
  return events
    .filter((e) => e.kind === COMMENT_KIND && players.includes(e.pubkey) && e.tags.some((t) => t[0] === 'A' && t[1] === coordinate))
    .map((e) => ({ id: e.id, author: e.pubkey, text: e.content.slice(0, MAX_CHAT_LENGTH), createdAt: e.created_at, event: e }))
    .filter((m) => m.text.trim() !== '')
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
}
