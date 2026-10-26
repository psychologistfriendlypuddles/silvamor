import * as nip19 from 'nostr-tools/nip19'
import { queryProfile } from 'nostr-tools/nip05'

/** Turns an npub, nprofile, hex key or NIP-05 address into a hex pubkey. */
export async function resolvePubkey(input: string): Promise<string> {
  const value = input.trim().replace(/^nostr:/, '')
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase()
  if (value.startsWith('npub1') || value.startsWith('nprofile1')) {
    const decoded = nip19.decode(value)
    if (decoded.type === 'npub') return decoded.data
    if (decoded.type === 'nprofile') return decoded.data.pubkey
  }
  if (value.includes('@') || value.includes('.')) {
    const pointer = await queryProfile(value)
    if (pointer) return pointer.pubkey
  }
  throw new Error(`Couldn't find a Nostr user for "${input}". Use their npub or NIP-05 address.`)
}
