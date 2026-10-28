import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey } from 'nostr-tools/pure'
import { pool } from './pool'
import { LocalKeySigner } from './signers'
import { NOTHING_KEPT, requestVanish } from './vanish'

afterEach(() => vi.restoreAllMocks())

/** Silvamor's relay takes the request, or refuses it for `reason`. */
const relayAnswers = (reason?: string) =>
  vi.spyOn(pool, 'publish').mockImplementation(() => [reason ? Promise.reject(new Error(`blocked: ${reason}`)) : Promise.resolve('')])

describe("deleting your data from Silvamor's relay", () => {
  it('is done when the relay takes the request, or keeps nothing from the key anyway', async () => {
    const signer = new LocalKeySigner(generateSecretKey())
    relayAnswers()
    await expect(requestVanish(signer)).resolves.toBeUndefined()
    relayAnswers(NOTHING_KEPT)
    await expect(requestVanish(signer)).resolves.toBeUndefined()
  })

  it('fails, saying why, when the relay refuses for another reason', async () => {
    relayAnswers("couldn't delete your events, please try again")
    await expect(requestVanish(new LocalKeySigner(generateSecretKey()))).rejects.toThrow("didn't delete your data: couldn't delete your events, please try again")
  })
})
