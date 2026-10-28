import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { LocalKeySigner } from './nostr/signers'
import { connectedNwc, hasNwc, removeNwc, saveNwc } from './payments'

const secret = 'b'.repeat(64)
const link = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${secret}`
const sk = generateSecretKey()
const pubkey = getPublicKey(sk)

/** A stand-in for the browser's localStorage, which shows everything it holds. */
function storage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    held: () => [...items.values()].join('\n'),
  }
}

let stored: ReturnType<typeof storage>
beforeEach(() => vi.stubGlobal('localStorage', (stored = storage())))
afterEach(() => vi.unstubAllGlobals())

describe('a connected wallet', () => {
  it("is kept only encrypted to the player's key, which a later login reads it back with", async () => {
    await saveNwc(new LocalKeySigner(sk), pubkey, link)
    expect(hasNwc(pubkey)).toBe(true)
    expect(stored.held()).not.toContain(secret)
    expect(await connectedNwc(new LocalKeySigner(sk), pubkey)).toBe(link)
    await expect(connectedNwc(new LocalKeySigner(generateSecretKey()), pubkey)).rejects.toThrow()
  })

  it('encrypts a link an earlier version kept in the clear, the first time it is used', async () => {
    localStorage.setItem(`silvamor:nwc:${pubkey}`, link)
    expect(await connectedNwc(new LocalKeySigner(sk), pubkey)).toBe(link)
    expect(stored.held()).not.toContain(secret)
    expect(await connectedNwc(new LocalKeySigner(sk), pubkey)).toBe(link)
  })

  it('is forgotten when disconnected', async () => {
    const signer = new LocalKeySigner(sk)
    await saveNwc(signer, pubkey, link)
    removeNwc(signer, pubkey)
    expect(hasNwc(pubkey)).toBe(false)
    await expect(connectedNwc(signer, pubkey)).rejects.toThrow('No wallet is connected')
  })
})
