import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent } from 'nostr-tools/pure'
import * as nip04 from 'nostr-tools/nip04'
import { hexToBytes } from 'nostr-tools/utils'
import type { AppSigner } from './nostr/signers'

// Paying Lightning invoices from the app: a connected wallet (Nostr Wallet Connect,
// NIP-47), a browser extension (WebLN), or the player's own wallet via a QR code.

declare global {
  interface Window {
    webln?: { enable(): Promise<void>; sendPayment(invoice: string): Promise<{ preimage: string }> }
  }
}

// --- Nostr Wallet Connect (NIP-47) ---

interface NwcConnection {
  /** The wallet service's pubkey. */
  wallet: string
  relays: string[]
  /** This app's key for talking to the wallet. */
  secret: string
}

/** Reads a `nostr+walletconnect://<wallet>?relay=…&secret=…` link. */
export function parseNwc(value: string): NwcConnection {
  const url = new URL(value.trim().replace(/^nostr\+walletconnect:/, 'http:'))
  const wallet = url.hostname || url.pathname.replace(/^\/+/, '')
  const relays = url.searchParams.getAll('relay')
  const secret = url.searchParams.get('secret') ?? ''
  if (!/^[0-9a-f]{64}$/.test(wallet) || !/^[0-9a-f]{64}$/.test(secret) || relays.length === 0) {
    throw new Error('That is not a Nostr Wallet Connect link (nostr+walletconnect://…).')
  }
  return { wallet, relays, secret }
}

const nwcKey = (pubkey: string) => `silvamor:nwc:${pubkey}`
/** Connections read during a login, by that login's signer, so they go with it. */
const unlocked = new WeakMap<AppSigner, string>()

/**
 * The connection string can spend from the wallet within whatever budget the user gave it, so this
 * browser keeps it only encrypted to the player's own key (NIP-44): stored, it's no use without the key.
 */
export async function saveNwc(signer: AppSigner, pubkey: string, connection: string) {
  parseNwc(connection) // throws on garbage
  localStorage.setItem(nwcKey(pubkey), await signer.nip44Encrypt(pubkey, connection.trim()))
  unlocked.set(signer, connection.trim())
}

export function removeNwc(signer: AppSigner, pubkey: string) {
  localStorage.removeItem(nwcKey(pubkey))
  unlocked.delete(signer)
}

/** Whether a wallet is connected for `pubkey` in this browser. */
export function hasNwc(pubkey: string): boolean {
  try {
    return localStorage.getItem(nwcKey(pubkey)) !== null
  } catch {
    return false
  }
}

/** The connected wallet's link, decrypted with the player's key the first time it's needed in a login. */
export async function connectedNwc(signer: AppSigner, pubkey: string): Promise<string> {
  const known = unlocked.get(signer)
  if (known) return known
  const stored = localStorage.getItem(nwcKey(pubkey))
  if (!stored) throw new Error('No wallet is connected on this device.')
  // Earlier versions kept the link in the clear: encrypt it now.
  if (stored.startsWith('nostr+walletconnect:')) {
    await saveNwc(signer, pubkey, stored)
    return stored
  }
  const connection = await signer.nip44Decrypt(pubkey, stored)
  unlocked.set(signer, connection)
  return connection
}

export function isNwcConnection(value: string): boolean {
  try {
    parseNwc(value)
    return true
  } catch {
    return false
  }
}

/** Pays an invoice through a Nostr Wallet Connect wallet; resolves when the wallet confirms. */
export async function payWithNwc(connection: string, invoice: string, timeoutMs = 60_000): Promise<void> {
  const { wallet, relays, secret } = parseNwc(connection)
  const sk = hexToBytes(secret)
  const request = finalizeEvent(
    {
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', wallet]],
      content: nip04.encrypt(sk, wallet, JSON.stringify({ method: 'pay_invoice', params: { invoice } })),
    },
    sk,
  )
  const pool = new SimplePool()
  try {
    const response = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Your wallet didn't answer. Check it's online.")), timeoutMs)
      pool.subscribe(relays, { kinds: [23195], authors: [wallet], '#e': [request.id] }, {
        onevent: (e) => {
          clearTimeout(timer)
          try {
            const reply = JSON.parse(nip04.decrypt(sk, wallet, e.content)) as { error?: { message?: string } | null }
            if (reply.error) reject(new Error(`Your wallet refused: ${reply.error.message ?? 'unknown error'}`))
            else resolve()
          } catch {
            reject(new Error("Couldn't read your wallet's answer."))
          }
        },
      })
    })
    await Promise.any(pool.publish(relays, request)).catch(() => {
      throw new Error("Couldn't reach your wallet's relay.")
    })
    await response
  } finally {
    pool.destroy()
  }
}

/** The ways this browser can pay right now, best first. */
export function paymentMethods(pubkey: string): ('nwc' | 'webln')[] {
  const methods: ('nwc' | 'webln')[] = []
  if (hasNwc(pubkey)) methods.push('nwc')
  if (typeof window !== 'undefined' && window.webln) methods.push('webln')
  return methods
}

export async function payInvoice(signer: AppSigner, pubkey: string, invoice: string, method: 'nwc' | 'webln') {
  if (method === 'nwc') return payWithNwc(await connectedNwc(signer, pubkey), invoice)
  await window.webln!.enable()
  await window.webln!.sendPayment(invoice)
}
