import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { buildZapRequest, requestPlainInvoice, requestZapInvoice, type LnurlPay } from './zaps'

const lnurl: LnurlPay = { callback: 'https://wallet.example/lnurlp/callback', minSendable: 1000, maxSendable: 100_000_000_000 }
const zap = finalizeEvent(buildZapRequest({ recipient: getPublicKey(generateSecretKey()), sats: 21, relays: ['wss://relay.example'], content: '' }), generateSecretKey())
/** Invoice-shaped: the amount is read from the prefix ("210n" is 21 sats, "10m" a million). */
const invoice = (amount: string) => `lnbc${amount}1${'q'.repeat(100)}`
/** The recipient's server answers every invoice request with `pr`. */
const answers = (pr: string) => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ pr })))

afterEach(() => vi.unstubAllGlobals())

describe('invoices from a Lightning address', () => {
  it('takes one for exactly the amount offered', async () => {
    answers(invoice('210n'))
    await expect(requestZapInvoice(lnurl, zap, 21)).resolves.toBe(invoice('210n'))
  })

  it("refuses one asking for more, so a tip can't drain a wallet", async () => {
    answers(invoice('10m'))
    await expect(requestZapInvoice(lnurl, zap, 21)).rejects.toThrow('asked for 1M instead of 21 sats')
    await expect(requestPlainInvoice(lnurl, 21, '')).rejects.toThrow('asked for 1M instead of 21 sats')
  })

  it('refuses one that leaves the amount open', async () => {
    answers(invoice(''))
    await expect(requestZapInvoice(lnurl, zap, 21)).rejects.toThrow('without an amount')
  })
})
