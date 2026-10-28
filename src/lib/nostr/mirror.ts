import type { Event } from 'nostr-tools/pure'
import { HOME_RELAY, pool } from './pool'

/**
 * The player's own events Silvamor copies to the home relay: profile, follow list and relay
 * list. They're already signed, so copying needs no new signature, and the home relay then
 * has everything leaderboards and streak reminders need without asking other relays.
 */
export const MIRRORED_KINDS = [0, 3, 10002]

/** The newest of each kind found elsewhere that the home relay doesn't have yet. */
export function toMirror(elsewhere: Event[], home: Event[]): Event[] {
  const newest = new Map<number, Event>()
  for (const e of elsewhere) {
    if (!MIRRORED_KINDS.includes(e.kind)) continue
    const known = newest.get(e.kind)
    if (!known || e.created_at > known.created_at) newest.set(e.kind, e)
  }
  return [...newest.values()].filter((e) => !home.some((h) => h.kind === e.kind && h.pubkey === e.pubkey && h.created_at >= e.created_at))
}

/** Copies the player's latest profile, follow list and relay list from `sources` to the home relay. */
export async function mirrorToHome(pubkey: string, sources: string[]): Promise<number> {
  const others = sources.filter((r) => r !== HOME_RELAY)
  if (others.length === 0) return 0
  const filter = { kinds: MIRRORED_KINDS, authors: [pubkey] }
  const [elsewhere, home] = await Promise.all([pool.querySync(others, filter, { maxWait: 5000 }), pool.querySync([HOME_RELAY], filter, { maxWait: 5000 })])
  const missing = toMirror(elsewhere, home)
  await Promise.allSettled(missing.flatMap((e) => pool.publish([HOME_RELAY], e)))
  return missing.length
}
