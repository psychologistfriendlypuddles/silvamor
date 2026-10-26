import { useEffect } from 'react'
import type { Event } from 'nostr-tools/pure'
import { pool, publishTo } from '../lib/nostr/pool'
import { GAME_JOIN_KIND, buildAction, updateListing, type GameListing } from '../lib/nostr/gameEvents'
import { inviteKey, verifyJoinProof } from '../lib/gameCrypto'
import { zappable } from '../lib/wager'
import { useProfiles } from '../stores/profiles'
import type { AppSigner } from '../lib/nostr/signers'
import { useSession } from '../stores/session'
import { useLobby } from '../stores/lobby'
import { gameReadRelays, gameWriteRelays, useRelays } from '../stores/relays'
import { useBlocks } from '../stores/blocks'
import { toast } from '../stores/toast'

/** Games already started this session, so two relays delivering the same join don't start twice. */
const handled = new Set<string>()

/** Invite keys per link game, decrypted once from the listing with the host's signer. */
const inviteKeys = new Map<string, Promise<Uint8Array | null>>()

function linkKey(listing: GameListing, signer: AppSigner): Promise<Uint8Array | null> {
  if (!inviteKeys.has(listing.coordinate)) {
    const key = listing.invite
      ? signer.nip44Decrypt(listing.host, listing.invite).then(inviteKey, () => null)
      : Promise.resolve(null)
    inviteKeys.set(listing.coordinate, key)
  }
  return inviteKeys.get(listing.coordinate)!
}

async function joinIsValid(listing: GameListing, join: Event, signer: AppSigner): Promise<boolean> {
  if (join.pubkey === listing.host) return false
  if (listing.wager) {
    // The joiner must have agreed to this exact stake and be payable if they win.
    if (join.tags.find((t) => t[0] === 'wager')?.[1] !== String(listing.wager)) return false
    await useProfiles.getState().fetch(join.pubkey)
    if (!(await zappable(useProfiles.getState().profiles[join.pubkey]?.content.lud16))) return false
  }
  if (listing.access === 'invite') return listing.pubkeys.includes(join.pubkey)
  if (listing.access === 'link') {
    const key = await linkKey(listing, signer)
    return !!key && verifyJoinProof(join.content, join.pubkey, key)
  }
  return true
}

/**
 * While the app is open, the host's client lets the first valid joiner into
 * each of the host's open games by publishing the start action (docs/PROTOCOL.md).
 */
export function useHostAgent() {
  const { pubkey, signer } = useSession()
  // Resubscribe when the user's saved relay list changes.
  const relayKey = useRelays((s) => s.published.map((r) => r.url).join(','))

  useEffect(() => {
    if (!pubkey || !signer) return

    const process = async (join: Event) => {
      const coordinate = join.tags.find((t) => t[0] === 'a')?.[1]
      if (!coordinate || handled.has(coordinate)) return
      const listing = useLobby.getState().listings[coordinate]
      if (!listing || listing.host !== pubkey || listing.status !== 'open') return
      if (!(await joinIsValid(listing, join, signer))) return
      // A clocked game starts its first turn at the current block; without one, wait and retry.
      const block = listing.blocks ? await useBlocks.getState().refresh() : null
      if (listing.blocks && block === null) return
      handled.add(coordinate)

      try {
        const players = Math.random() < 0.5 ? [pubkey, join.pubkey] : [join.pubkey, pubkey]
        const relays = gameWriteRelays()
        const start = await signer.signEvent(buildAction(listing, { type: 'start', n: 0, players }, { others: [join.pubkey], block }))
        await publishTo(relays, start)
        const updated = await signer.signEvent(updateListing(listing, { status: 'active', pubkeys: players, startId: start.id }))
        await publishTo(relays, updated)
        useLobby.getState().add(updated)
        // The "joined your game" notification comes from the game watcher.
      } catch (err) {
        handled.delete(coordinate)
        toast.error(err)
      }
    }

    // One join at a time: checks are async, and two joins must never both start a game.
    let queue = Promise.resolve()
    const onJoin = (join: Event) => {
      queue = queue.then(() => process(join))
    }

    const sub = pool.subscribe(
      gameReadRelays(),
      { kinds: [GAME_JOIN_KIND], '#p': [pubkey], since: Math.floor(Date.now() / 1000) - 14 * 24 * 3600 },
      { onevent: onJoin },
    )
    // Joins can arrive before the lobby knows about the listing; retry those briefly.
    const retry = setInterval(() => {
      for (const listing of Object.values(useLobby.getState().listings)) {
        if (listing.host === pubkey && listing.status === 'open' && !handled.has(listing.coordinate)) {
          pool.querySync(gameReadRelays(), { kinds: [GAME_JOIN_KIND], '#a': [listing.coordinate] }, { maxWait: 3000 }).then(
            (joins) => joins.sort((a, b) => a.created_at - b.created_at).forEach(onJoin),
            () => {},
          )
        }
      }
    }, 15000)
    return () => {
      sub.close()
      clearInterval(retry)
    }
  }, [pubkey, signer, relayKey])
}
