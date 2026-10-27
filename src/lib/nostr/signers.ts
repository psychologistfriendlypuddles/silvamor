import { finalizeEvent, getPublicKey, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { BunkerSigner, type BunkerPointer } from 'nostr-tools/nip46'
import { pool } from './pool'
import { trackSignerRequest } from '../../stores/signerActivity'

/**
 * Everything the app needs from a signer. NIP-44 encryption will be used for
 * private games (whitelisted players) in a later phase.
 */
export interface AppSigner {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>
  close?(): Promise<void> | void
}

// --- NIP-07: browser extension (Alby, nos2x, Nostr Connect, ...) ---

interface Nip07 {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

declare global {
  interface Window {
    nostr?: Nip07
  }
}

/** Extensions inject window.nostr asynchronously, so give them a moment. */
export async function waitForExtension(timeoutMs = 2000): Promise<Nip07 | null> {
  const start = Date.now()
  while (!window.nostr && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100))
  }
  return window.nostr ?? null
}

export class Nip07Signer implements AppSigner {
  private ext: Nip07
  constructor(ext: Nip07) {
    this.ext = ext
  }
  getPublicKey() {
    return this.ext.getPublicKey()
  }
  signEvent(event: EventTemplate) {
    return this.ext.signEvent(event)
  }
  nip44Encrypt(pubkey: string, plaintext: string) {
    if (!this.ext.nip44) throw new Error('Your extension does not support NIP-44 encryption.')
    return this.ext.nip44.encrypt(pubkey, plaintext)
  }
  nip44Decrypt(pubkey: string, ciphertext: string) {
    if (!this.ext.nip44) throw new Error('Your extension does not support NIP-44 encryption.')
    return this.ext.nip44.decrypt(pubkey, ciphertext)
  }
}

// --- Local key: nsec typed in by the user, kept in memory only ---

export class LocalKeySigner implements AppSigner {
  private sk: Uint8Array
  private pk: string
  constructor(sk: Uint8Array) {
    this.sk = sk
    this.pk = getPublicKey(sk)
  }
  async getPublicKey() {
    return this.pk
  }
  async signEvent(event: EventTemplate) {
    return finalizeEvent(event, this.sk)
  }
  async nip44Encrypt(pubkey: string, plaintext: string) {
    return nip44.encrypt(plaintext, nip44.getConversationKey(this.sk, pubkey))
  }
  async nip44Decrypt(pubkey: string, ciphertext: string) {
    return nip44.decrypt(ciphertext, nip44.getConversationKey(this.sk, pubkey))
  }
  close() {
    this.sk.fill(0)
  }
}

// --- NIP-46: remote signer (Amber, nsec.app, nsecBunker, ...) ---

/**
 * Permissions asked for when connecting, per event kind, so signer apps can offer
 * "always allow" for Silvamor's events instead of asking every time.
 */
export const NIP46_PERMS = [
  'get_public_key',
  'sign_event:0', // profile
  'sign_event:5', // delete a group
  'sign_event:1952', // Daily Deal runs
  'sign_event:1984', // report a sprite
  'sign_event:9734', // zap requests: tipping a player or an artist
  'sign_event:10002', // relay list
  'sign_event:24242', // Blossom upload authorization
  'sign_event:27235', // signed requests to the push service (NIP-98)
  'sign_event:30000', // groups
  'sign_event:30004', // featured sprites
  'sign_event:30078', // sprite choice and private settings
  'sign_event:30951', // publishing a sprite
  'nip44_encrypt', // invite-link secrets and settings, encrypted to yourself
  'nip44_decrypt',
]

export class Nip46Signer implements AppSigner {
  readonly bunker: BunkerSigner
  constructor(bunker: BunkerSigner) {
    this.bunker = bunker
  }

  /** Reconnect to a signer we paired with in a previous session. */
  static restore(clientSecretKey: Uint8Array, bp: BunkerPointer) {
    return new Nip46Signer(BunkerSigner.fromBunker(clientSecretKey, bp, { pool, onauth: openAuthUrl }))
  }

  // Each request waits for the signer app; tracked so the UI can say "go approve it".
  getPublicKey() {
    return trackSignerRequest(this.bunker.getPublicKey())
  }
  signEvent(event: EventTemplate) {
    return trackSignerRequest(this.bunker.signEvent(event))
  }
  nip44Encrypt(pubkey: string, plaintext: string) {
    return trackSignerRequest(this.bunker.nip44Encrypt(pubkey, plaintext))
  }
  nip44Decrypt(pubkey: string, ciphertext: string) {
    return trackSignerRequest(this.bunker.nip44Decrypt(pubkey, ciphertext))
  }
  close() {
    return this.bunker.close()
  }
}

/** Some bunkers ask the user to approve the app on a web page first. */
export function openAuthUrl(url: string) {
  window.open(url, '_blank', 'width=600,height=700,noopener')
}
