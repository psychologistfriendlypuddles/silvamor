import { create } from 'zustand'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'
import { BunkerSigner, parseBunkerInput, type BunkerPointer } from 'nostr-tools/nip46'
import { pool } from '../lib/nostr/pool'
import {
  LocalKeySigner,
  Nip07Signer,
  Nip46Signer,
  openAuthUrl,
  waitForExtension,
  type AppSigner,
} from '../lib/nostr/signers'

export type LoginMethod = 'nip07' | 'nsec' | 'nip46'

/**
 * What survives a page reload. The raw private key is NEVER stored: a typed-in
 * nsec is only kept as a NIP-49 ncryptsec (password-encrypted), and the NIP-46
 * client key is a throwaway key that only identifies this device to the signer.
 */
type StoredSession =
  | { method: 'nip07'; pubkey: string }
  | { method: 'nsec'; pubkey: string; ncryptsec: string }
  | { method: 'nip46'; pubkey: string; clientSecret: string; bunker: BunkerPointer }

const STORAGE_KEY = 'silvamor:session'

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function writeStored(session: StoredSession | null) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  else localStorage.removeItem(STORAGE_KEY)
}

const DEVICE_KEY = 'silvamor:nip46-device-key'

/**
 * The key this device uses to talk to remote signer apps (NIP-46). Signers list
 * each app key as its own "connected app", so reusing one per device (even across
 * log out / log in) stops duplicates piling up. It identifies this browser to the
 * signer only; it is not the user's identity.
 */
export function deviceSignerKey(): Uint8Array {
  try {
    const stored = localStorage.getItem(DEVICE_KEY)
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return hexToBytes(stored)
  } catch {
    /* storage unavailable: fall through to a fresh key */
  }
  const key = generateSecretKey()
  try {
    localStorage.setItem(DEVICE_KEY, bytesToHex(key))
  } catch {
    /* fine: this session still works */
  }
  return key
}

/** Accepts nsec1…, 64-char hex, or (with a password) ncryptsec1…. */
export function parseSecretKey(input: string, password?: string): Uint8Array {
  const value = input.trim()
  if (value.startsWith('ncryptsec1')) {
    if (!password) throw new Error('This key is password-encrypted. Enter its password.')
    return nip49.decrypt(value, password)
  }
  if (value.startsWith('nsec1')) {
    const decoded = nip19.decode(value)
    if (decoded.type !== 'nsec') throw new Error('Not a valid nsec.')
    return decoded.data
  }
  if (/^[0-9a-f]{64}$/i.test(value)) return hexToBytes(value)
  throw new Error('That does not look like a private key (expected nsec1…).')
}

interface SessionState {
  status: 'booting' | 'signedOut' | 'locked' | 'signedIn'
  method: LoginMethod | null
  pubkey: string | null
  signer: AppSigner | null

  boot(): Promise<void>
  loginExtension(): Promise<void>
  loginNsec(input: string, opts: { remember: boolean; password?: string }): Promise<void>
  unlock(password: string): Promise<void>
  loginBunker(input: string): Promise<void>
  loginNostrConnect(clientSecret: Uint8Array, uri: string, signal: AbortSignal): Promise<void>
  createAccount(): { nsec: string; secretKey: Uint8Array }
  /** `reconnectSigner` opens the login page straight on the signer-app connection. */
  logout(opts?: { reconnectSigner?: boolean }): Promise<void>
  /** Which login option to open first, e.g. after "Reconnect" on a stuck signer. */
  loginHint: 'signer' | null
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'booting',
  loginHint: null,
  method: null,
  pubkey: null,
  signer: null,

  async boot() {
    const stored = readStored()
    if (!stored) return set({ status: 'signedOut' })

    if (stored.method === 'nsec') {
      // Needs the password before we can sign anything.
      return set({ status: 'locked', method: 'nsec', pubkey: stored.pubkey })
    }

    if (stored.method === 'nip07') {
      const ext = await waitForExtension()
      if (!ext) return set({ status: 'signedOut' })
      const signer = new Nip07Signer(ext)
      return set({ status: 'signedIn', method: 'nip07', pubkey: stored.pubkey, signer })
    }

    const signer = Nip46Signer.restore(hexToBytes(stored.clientSecret), stored.bunker)
    set({ status: 'signedIn', method: 'nip46', pubkey: stored.pubkey, signer })
  },

  async loginExtension() {
    const ext = await waitForExtension(500)
    if (!ext) throw new Error('No Nostr extension found. Try Alby, nos2x or Nostr Connect.')
    const signer = new Nip07Signer(ext)
    const pubkey = await signer.getPublicKey()
    writeStored({ method: 'nip07', pubkey })
    set({ status: 'signedIn', method: 'nip07', pubkey, signer })
  },

  async loginNsec(input, { remember, password }) {
    const isEncrypted = input.trim().startsWith('ncryptsec1')
    const sk = parseSecretKey(input, isEncrypted ? password : undefined)
    const pubkey = getPublicKey(sk)
    if (remember) {
      if (!password) throw new Error('Choose a password to keep your key encrypted on this device.')
      writeStored({ method: 'nsec', pubkey, ncryptsec: nip49.encrypt(sk, password) })
    } else {
      writeStored(null)
    }
    set({ status: 'signedIn', method: 'nsec', pubkey, signer: new LocalKeySigner(sk) })
  },

  async unlock(password) {
    const stored = readStored()
    if (stored?.method !== 'nsec') throw new Error('Nothing to unlock.')
    let sk: Uint8Array
    try {
      sk = nip49.decrypt(stored.ncryptsec, password)
    } catch {
      throw new Error('Wrong password.')
    }
    set({ status: 'signedIn', signer: new LocalKeySigner(sk) })
  },

  async loginBunker(input) {
    const bp = await parseBunkerInput(input.trim())
    if (!bp) throw new Error('Expected a bunker:// URL or a NIP-05 address of your signer.')
    const clientSecret = deviceSignerKey()
    const bunker = BunkerSigner.fromBunker(clientSecret, bp, { pool, onauth: openAuthUrl })
    await bunker.connect({ name: 'Silvamor', url: location.origin })
    const pubkey = await bunker.getPublicKey()
    // The connect secret is single-use; don't keep it around.
    writeStored({ method: 'nip46', pubkey, clientSecret: bytesToHex(clientSecret), bunker: { ...bp, secret: null } })
    set({ status: 'signedIn', method: 'nip46', pubkey, signer: new Nip46Signer(bunker) })
  },

  async loginNostrConnect(clientSecret, uri, signal) {
    const bunker = await BunkerSigner.fromURI(clientSecret, uri, { pool, onauth: openAuthUrl }, signal)
    const pubkey = await bunker.getPublicKey()
    writeStored({ method: 'nip46', pubkey, clientSecret: bytesToHex(clientSecret), bunker: { ...bunker.bp, secret: null } })
    set({ status: 'signedIn', method: 'nip46', pubkey, signer: new Nip46Signer(bunker) })
  },

  createAccount() {
    const secretKey = generateSecretKey()
    return { secretKey, nsec: nip19.nsecEncode(secretKey) }
  },

  async logout(opts) {
    await get().signer?.close?.()
    writeStored(null)
    set({ status: 'signedOut', method: null, pubkey: null, signer: null, loginHint: opts?.reconnectSigner ? 'signer' : null })
  },
}))

/** For components that only render when signed in. */
export function useSigner() {
  const { signer, pubkey } = useSession()
  if (!signer || !pubkey) throw new Error('useSigner called while signed out')
  return { signer, pubkey }
}
