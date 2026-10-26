import * as nip44 from 'nostr-tools/nip44'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from 'nostr-tools/utils'

// Invite links: see docs/PROTOCOL.md, "Invite links".

/** 128 random bits, carried in the link's #fragment so it never reaches a web server. */
export function newInviteToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
}

/**
 * The 32-byte key both host and joiner derive from the token. Uses @noble/hashes
 * rather than crypto.subtle, which browsers withhold on plain-http addresses
 * (e.g. a phone opening the dev server at http://192.168.x.x).
 */
export async function inviteKey(token: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(`silvamor-invite:${token}`))
}

/**
 * Proof that the joiner holds the link, bound to their own pubkey: copying a proof
 * seen on a relay is useless to anyone else.
 */
export const makeJoinProof = (joiner: string, key: Uint8Array) => nip44.encrypt(joiner, key)

export function verifyJoinProof(proof: string, joiner: string, key: Uint8Array): boolean {
  try {
    return nip44.decrypt(proof, key) === joiner
  } catch {
    return false
  }
}

export function inviteFragment(token: string) {
  return `#invite=${token}`
}

export function readInviteFragment(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('invite')
  return token && /^[0-9a-f]{32}$/.test(token) ? token : null
}
