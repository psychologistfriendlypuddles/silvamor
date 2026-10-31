import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { askRelay } from './ask'

// One shared pool for the whole app so relay connections are reused.
export const pool = new SimplePool({ enablePing: true, enableReconnect: true })

// VITE_RELAYS (comma-separated) replaces every default, e.g. to use the local dev relay.
const OVERRIDE = import.meta.env.VITE_RELAYS?.split(',').map((r: string) => r.trim()).filter(Boolean) as string[] | undefined

/**
 * Silvamor's own relay. Every Silvamor event (runs, profiles, follow lists, groups, sprites…) is
 * published here whatever relays a player picks, so it holds everything leaderboards and
 * streak reminders need (docs/DEPLOY.md, "Relays"). VITE_HOME_RELAY changes it; with VITE_RELAYS
 * (local testing) it defaults to the first of those.
 */
export const HOME_RELAY: string = import.meta.env.VITE_HOME_RELAY ?? OVERRIDE?.[0] ?? 'wss://relay.silvamor.com'

// The starter list for players who haven't published a relay list (NIP-65) yet.
export const DEFAULT_RELAYS = [...new Set([HOME_RELAY, ...(OVERRIDE ?? ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'])])]

// Where profiles and relay lists are looked up and published, so other Nostr apps find them too:
// indexer relays that answer "what is this pubkey's profile / relay list?", plus the home relay.
export const DISCOVERY_RELAYS = OVERRIDE ? DEFAULT_RELAYS : ['wss://purplepag.es', 'wss://user.kindpag.es', HOME_RELAY]

/** Relays we always read and write Silvamor's events on, on top of the user's own: just the home relay. */
export const GAME_RELAYS = [HOME_RELAY]

// Relays commonly used by NIP-46 remote signers (Amber, nsec.app, ...). Several, so the
// login keeps working when one is down. (relay.silvamor.com keeps only Silvamor's own kinds,
// so signers couldn't send their replies through it.)
export const NIP46_RELAYS = OVERRIDE ?? ['wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

export function normalizeRelayUrl(input: string): string | null {
  let url = input.trim()
  if (!url) return null
  if (!/^wss?:\/\//i.test(url)) url = `wss://${url}`
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null
    // Drop a lone trailing slash so "wss://a.com/" and "wss://a.com" are the same relay.
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/**
 * The events matching `filter` on `relay`, failing when it doesn't answer within `maxWait` ms.
 * `pool.querySync` resolves with nothing then, as if there were none, so a lost connection looked
 * like a day nobody played.
 */
export function queryOrFail(relay: string, filter: Filter, maxWait = 8000): Promise<Event[]> {
  return askRelay(pool, relay, filter, maxWait)
}

/** Publish to several relays; resolves with which relays accepted the event. */
export async function publishTo(relays: string[], event: Parameters<SimplePool['publish']>[1]) {
  const results = await Promise.allSettled(pool.publish(relays, event, { maxWait: 6000 }))
  const ok = relays.filter((_, i) => results[i].status === 'fulfilled')
  if (ok.length === 0) throw new Error('No relay accepted the event. Check your relay list.')
  return ok
}
