import type { EventTemplate } from 'nostr-tools/pure'
import { HOME_RELAY, pool } from './pool'
import type { AppSigner } from './signers'

// Deleting a player's data from Silvamor's relay: a NIP-62 "request to vanish" for that relay only.
// The relay guard (guard/) deletes everything the key published there and refuses it if it's
// uploaded again. Other relays aren't asked.

export const VANISH_KIND = 62

export function buildVanishRequest(relay = HOME_RELAY): EventTemplate {
  return { kind: VANISH_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['relay', relay]], content: '' }
}

/** Signs and sends the request; resolves once the relay has accepted it, so the deletion is done. */
export async function requestVanish(signer: AppSigner) {
  const event = await signer.signEvent(buildVanishRequest())
  try {
    await pool.publish([HOME_RELAY], event, { maxWait: 15_000 })[0]
  } catch (err) {
    const reason = String(err instanceof Error ? err.message : err).replace(/^blocked: /, '')
    throw new Error(`${HOME_RELAY.replace(/^wss?:\/\//, '')} didn't delete your data: ${reason}`, { cause: err })
  }
}

/** Forgets what this browser keeps for `pubkey`: its relays, notices, settings, wallet link and runs. */
export function forgetLocalData(pubkey: string) {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k?.includes(pubkey))
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    // Storage blocked: there's nothing kept to forget.
  }
}
