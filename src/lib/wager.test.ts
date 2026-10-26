import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { makeZapReceipt } from 'nostr-tools/nip57'
import { buildListing, parseListing } from './nostr/gameEvents'
import {
  MAX_WAGER,
  PAYMENT_GRACE_SECONDS,
  buildWagerZapRequest,
  computeHonor,
  formatSats,
  lnurlpUrl,
  parseWager,
  paymentFromReceipt,
  satsFromSlider,
  sliderFromSats,
  type FinishedGame,
  type WagerPayment,
} from './wager'

describe('formatting stakes', () => {
  it('shows exact sats below 10,000 and shorthand above', () => {
    expect(formatSats(1)).toBe('1 sat')
    expect(formatSats(21)).toBe('21 sats')
    expect(formatSats(9999)).toBe('9,999 sats')
    const cases: [number, string][] = [
      [10_000, '10k'], [15_000, '15k'], [50_000, '50k'], [99_999, '99k'], [110_000, '110k'], [464_000, '464k'], [943_500, '943k'],
      [1_000_000, '1M'], [1_300_000, '1.3M'], [11_000_000, '11M'], [45_000_000, '45M'], [100_000_000, '1BTC'],
    ]
    for (const [sats, text] of cases) expect(formatSats(sats)).toBe(text)
  })

  it('the slider spans 1 sat to 1 BTC and round-trips', () => {
    expect(satsFromSlider(0)).toBe(1)
    expect(satsFromSlider(1000)).toBe(MAX_WAGER)
    expect(satsFromSlider(sliderFromSats(21))).toBe(21)
  })

  it('accepts only whole stakes from 1 sat to 1 BTC', () => {
    expect(parseWager('21')).toBe(21)
    for (const bad of ['0', '-5', '1.5', '100000001', 'lots', undefined]) expect(parseWager(bad)).toBeNull()
  })

  it('finds the LNURL endpoint of a Lightning address', () => {
    expect(lnurlpUrl('alice@getalby.com')).toBe('https://getalby.com/.well-known/lnurlp/alice')
    expect(lnurlpUrl('bob@localhost:7777')).toBe('http://localhost:7777/.well-known/lnurlp/bob')
    expect(lnurlpUrl('not an address')).toBeNull()
  })
})

describe('wager payments (zap receipts)', () => {
  const host = generateSecretKey()
  const loserSk = generateSecretKey()
  const provider = generateSecretKey()
  const winner = getPublicKey(host)
  const listing = parseListing(finalizeEvent(buildListing({ id: 'w', game: 'tictactoe', status: 'finished', access: 'open', blocks: null, pubkeys: [] }), host))!
  // A plausible 21-sat invoice (210n = 21 sats): only its amount is read, and it must be invoice-length.
  const bolt11 = 'lnbc210n1' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(3)
  const receipt = (signer = provider, zapRequestSk = loserSk) => {
    const request = finalizeEvent(buildWagerZapRequest(listing, winner, 21, ['wss://r'], 'test'), zapRequestSk)
    return finalizeEvent(makeZapReceipt({ zapRequest: JSON.stringify(request), bolt11, paidAt: new Date() }), signer)
  }

  it('reads payer, payee, game and amount from a receipt by the winner’s provider', () => {
    expect(paymentFromReceipt(receipt(), getPublicKey(provider))).toMatchObject({
      coordinate: listing.coordinate,
      payer: getPublicKey(loserSk),
      payee: winner,
      sats: 21,
    })
  })

  it('rejects receipts not signed by the winner’s Lightning provider', () => {
    expect(paymentFromReceipt(receipt(loserSk), getPublicKey(provider))).toBeNull() // the loser faking one
  })
})

describe('honor', () => {
  const me = 'a'.repeat(64)
  const them = 'b'.repeat(64)
  const now = 2_000_000_000
  const old = now - PAYMENT_GRACE_SECONDS - 60
  let n = 0
  /** A finished game; `lost` = I lost a wager of 21 sats. */
  const game = (opts: { lost?: boolean; wager?: boolean; endedAt?: number } = {}): FinishedGame => ({
    coordinate: `g${n++}`,
    endedAt: opts.endedAt ?? old - n,
    players: [me, them],
    winner: opts.lost ? 1 : 0,
    wager: opts.wager === false ? null : 21,
  })
  const paid = (g: FinishedGame): WagerPayment => ({ coordinate: g.coordinate, payer: me, payee: them, sats: 21, at: g.endedAt + 60 })
  const many = (count: number, make: () => FinishedGame = () => game()) => Array.from({ length: count }, make)

  /** A lost game paid to its own new winner. */
  const lostTo = (winner: string): FinishedGame => ({ ...game({ lost: true }), players: [me, winner] })
  const paidTo = (g: FinishedGame): WagerPayment => ({ coordinate: g.coordinate, payer: me, payee: g.players[1], sats: 21, at: g.endedAt + 60 })
  const winners = (count: number) => Array.from({ length: count }, (_, i) => lostTo(i.toString(16).padStart(64, 'c')))

  it('is "new" until a wager is lost; games without wagers or won ones do not matter', () => {
    expect(computeHonor(me, [...many(50), game({ lost: true, wager: false })], [], now)).toMatchObject({ tier: 'new', paid: 0, unpaid: 0 })
  })

  it('red while a wager is over 24 hours overdue, cleared as soon as it is paid', () => {
    const lost = game({ lost: true })
    expect(computeHonor(me, [lost], [], now)).toMatchObject({ tier: 'red', unpaid: 1, overdueFor: now - lost.endedAt - PAYMENT_GRACE_SECONDS })
    expect(computeHonor(me, [lost], [paid(lost)], now)).toMatchObject({ tier: 'bronze', paid: 1, unpaid: 0 })
    // Even a long paying history goes red with one overdue wager.
    const history = winners(30)
    expect(computeHonor(me, [...history, lost], history.map(paidTo), now).tier).toBe('red')
  })

  it('a lost wager within the grace period is pending, not red', () => {
    expect(computeHonor(me, [game({ lost: true, endedAt: now - 60 })], [], now)).toMatchObject({ tier: 'new', pending: 1, unpaid: 0 })
  })

  it('bronze, silver and gold: paid wagers to 1, 10 and 25 different winners', () => {
    const tierFor = (n: number) => {
      const lost = winners(n)
      return computeHonor(me, lost, lost.map(paidTo), now).tier
    }
    expect([tierFor(1), tierFor(9), tierFor(10), tierFor(24), tierFor(25)]).toEqual(['bronze', 'bronze', 'silver', 'silver', 'gold'])
  })

  it('paying the same winner again and again does not climb the tiers', () => {
    const lost = many(40, () => game({ lost: true }))
    expect(computeHonor(me, lost, lost.map(paid), now)).toMatchObject({ tier: 'bronze', paid: 40, winnersPaid: 1 })
  })
})

describe('wallet connect links', () => {
  it('reads a NIP-47 connection link and rejects anything else', async () => {
    const { parseNwc, isNwcConnection } = await import('./payments')
    const link = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'c'.repeat(64)}&lud16=me%40wallet.example`
    expect(parseNwc(link)).toEqual({ wallet: 'b'.repeat(64), relays: ['wss://relay.example'], secret: 'c'.repeat(64) })
    expect(isNwcConnection('nsec1abc')).toBe(false)
    expect(isNwcConnection(`nostr+walletconnect://${'b'.repeat(64)}?secret=${'c'.repeat(64)}`)).toBe(false) // no relay
  })
})
