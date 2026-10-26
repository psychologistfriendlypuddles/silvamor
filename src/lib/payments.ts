import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent } from 'nostr-tools/pure'
import * as nip04 from 'nostr-tools/nip04'
import { hexToBytes } from 'nostr-tools/utils'

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
const autoPayKey = (pubkey: string) => `silvamor:autopay:${pubkey}`

/**
 * The connection string can spend from the wallet within whatever budget the user gave it,
 * so it's kept only in this browser (like a remembered login).
 */
export function savedNwc(pubkey: string): string | null {
  try {
    return localStorage.getItem(nwcKey(pubkey))
  } catch {
    return null
  }
}

export function saveNwc(pubkey: string, connection: string | null) {
  if (connection) {
    parseNwc(connection) // throws on garbage
    localStorage.setItem(nwcKey(pubkey), connection.trim())
  } else {
    localStorage.removeItem(nwcKey(pubkey))
    localStorage.removeItem(autoPayKey(pubkey))
  }
}

export const autoPayOn = (pubkey: string) => {
  try {
    return localStorage.getItem(autoPayKey(pubkey)) === 'yes' && !!savedNwc(pubkey)
  } catch {
    return false
  }
}
export const setAutoPay = (pubkey: string, on: boolean) => (on ? localStorage.setItem(autoPayKey(pubkey), 'yes') : localStorage.removeItem(autoPayKey(pubkey)))

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
  if (savedNwc(pubkey)) methods.push('nwc')
  if (typeof window !== 'undefined' && window.webln) methods.push('webln')
  return methods
}

export async function payInvoice(pubkey: string, invoice: string, method: 'nwc' | 'webln') {
  if (method === 'nwc') return payWithNwc(savedNwc(pubkey)!, invoice)
  await window.webln!.enable()
  await window.webln!.sendPayment(invoice)
}
