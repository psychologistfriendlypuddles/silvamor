import type { EventTemplate, Event } from 'nostr-tools/pure'
import { normalizeRelayUrl } from './pool'

// NIP-65 relay list metadata (kind 10002).
export const RELAY_LIST_KIND = 10002

export interface RelayEntry {
  url: string
  read: boolean
  write: boolean
}

export function parseRelayList(event: Event): RelayEntry[] {
  const entries = new Map<string, RelayEntry>()
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue
    const url = normalizeRelayUrl(tag[1])
    if (!url) continue
    const marker = tag[2]
    entries.set(url, { url, read: marker !== 'write', write: marker !== 'read' })
  }
  return [...entries.values()]
}

export function buildRelayListEvent(relays: RelayEntry[]): EventTemplate {
  return {
    kind: RELAY_LIST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: relays
      .filter((r) => r.read || r.write)
      .map((r) => (r.read && r.write ? ['r', r.url] : ['r', r.url, r.read ? 'read' : 'write'])),
  }
}
