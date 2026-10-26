import type { Event, EventTemplate } from 'nostr-tools/pure'
import { getSatoshisAmountFromBolt11, validateZapRequest } from 'nostr-tools/nip57'
import type { GameListing } from './nostr/gameEvents'

// Friendly wagers (docs/PROTOCOL.md, "Wagers"): an honor system. Nobody holds the stake;
// the loser pays the winner with a zap (NIP-57) and the receipt shows it was paid.

export const MIN_WAGER = 1
export const MAX_WAGER = 100_000_000 // 1 BTC
export const DEFAULT_WAGER = 21
/** Above this, the warnings get louder. */
export const BIG_WAGER = 100
/** A lost wager only counts as unpaid this long after the game ended. */
export const PAYMENT_GRACE_SECONDS = 24 * 3600
export const ZAP_RECEIPT_KIND = 9735
const ZAP_REQUEST_KIND = 9734

/** "21 sats" up to 9,999; then 10k, 464k, 1M, 1.3M, 11M, 45M, 1BTC. */
export function formatSats(sats: number): string {
  if (sats < 10_000) return `${sats.toLocaleString('en-US')} ${sats === 1 ? 'sat' : 'sats'}`
  if (sats < 1_000_000) return `${Math.floor(sats / 1000)}k`
  if (sats < 10_000_000) return `${Math.floor(sats / 100_000) / 10}M`
  if (sats < 100_000_000) return `${Math.floor(sats / 1_000_000)}M`
  return `${Math.floor(sats / 10_000_000) / 10}BTC`
}

/** The stake slider is logarithmic (1 sat … 1 BTC), position 0…1000. */
export const SLIDER_STEPS = 1000
export const satsFromSlider = (position: number) =>
  Math.min(MAX_WAGER, Math.max(MIN_WAGER, Math.round(10 ** ((position / SLIDER_STEPS) * Math.log10(MAX_WAGER)))))
export const sliderFromSats = (sats: number) => Math.round((Math.log10(Math.max(MIN_WAGER, sats)) / Math.log10(MAX_WAGER)) * SLIDER_STEPS)

export function parseWager(value: string | undefined): number | null {
  const n = Number(value)
  return value !== undefined && Number.isSafeInteger(n) && n >= MIN_WAGER && n <= MAX_WAGER ? n : null
}

// --- Paying: Lightning addresses (LNURL-pay) and zaps ---

export interface LnurlPay {
  callback: string
  minSendable: number
  maxSendable: number
  allowsNostr?: boolean
  /** Signs this provider's zap receipts. */
  nostrPubkey?: string
}

/** name@domain → its LNURL-pay endpoint (plain http only for local testing). */
export function lnurlpUrl(lud16: string): string | null {
  const m = /^([a-z0-9._+-]+)@([a-z0-9.-]+(?::\d+)?)$/i.exec(lud16.trim())
  if (!m) return null
  const [, name, domain] = m
  return `${domain.startsWith('localhost') ? 'http' : 'https'}://${domain}/.well-known/lnurlp/${name}`
}

const lnurlCache = new Map<string, Promise<LnurlPay>>()

export function fetchLnurlPay(lud16: string): Promise<LnurlPay> {
  const url = lnurlpUrl(lud16)
  if (!url) return Promise.reject(new Error(`"${lud16}" isn't a Lightning address.`))
  if (!lnurlCache.has(url)) {
    const request = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<LnurlPay & { status?: string; reason?: string }>) : Promise.reject(new Error(`${r.status}`))))
      .then((d) => (d.status === 'ERROR' || !d.callback ? Promise.reject(new Error(d.reason ?? 'Not a Lightning address')) : d))
    request.catch(() => lnurlCache.delete(url)) // let a failed lookup be retried
    lnurlCache.set(url, request)
  }
  return lnurlCache.get(url)!
}

/** Whether a Lightning address can receive zaps (needed so payments can be seen and checked). */
export async function zappable(lud16: string | undefined): Promise<boolean> {
  if (!lud16) return false
  try {
    const lnurl = await fetchLnurlPay(lud16)
    return !!lnurl.allowsNostr && !!lnurl.nostrPubkey
  } catch {
    return false
  }
}

/**
 * A zap request (NIP-57) paying `recipient`, about an addressable event (`a` coordinate) when
 * given (a wager's game, a sprite). Without one it's a plain zap to the person, as tips to
 * players are: deliberately not tied to any game.
 */
export function buildZapRequest(f: { recipient: string; sats: number; relays: string[]; coordinate?: string; content: string }): EventTemplate {
  return {
    kind: ZAP_REQUEST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: f.content,
    tags: [
      ['p', f.recipient],
      ['amount', String(f.sats * 1000)],
      ['relays', ...f.relays],
      ...(f.coordinate ? [['a', f.coordinate], ['k', f.coordinate.split(':')[0]]] : []),
    ],
  }
}

/** The zap request a loser signs to pay a wager: to the winner, about this game. */
export function buildWagerZapRequest(listing: GameListing, winner: string, sats: number, relays: string[], title: string): EventTemplate {
  return buildZapRequest({ recipient: winner, sats, relays, coordinate: listing.coordinate, content: `Silvamor wager: ${title}` })
}

/** Asks the winner's Lightning provider for an invoice paying the signed zap request. */
export async function requestZapInvoice(lnurl: LnurlPay, zapRequest: Event, sats: number): Promise<string> {
  const msat = sats * 1000
  if (msat < lnurl.minSendable || msat > lnurl.maxSendable) {
    throw new Error(`The winner's wallet accepts ${formatSats(Math.ceil(lnurl.minSendable / 1000))} to ${formatSats(Math.floor(lnurl.maxSendable / 1000))}.`)
  }
  const url = new URL(lnurl.callback)
  url.searchParams.set('amount', String(msat))
  url.searchParams.set('nostr', JSON.stringify(zapRequest))
  const res = await fetch(url)
  const data = (await res.json().catch(() => ({}))) as { pr?: string; reason?: string }
  if (!res.ok || !data.pr) throw new Error(data.reason ?? "The winner's wallet didn't return an invoice.")
  return data.pr
}

export interface WagerPayment {
  coordinate: string
  payer: string
  payee: string
  sats: number
  at: number
}

/**
 * A zap receipt as a wager payment, or null if it doesn't hold up. Anyone can publish
 * a "receipt", so it must be signed by the payee's Lightning provider (when known) and
 * carry a valid zap request from the payer.
 */
export function paymentFromReceipt(receipt: Event, providerPubkey: string | null): WagerPayment | null {
  if (receipt.kind !== ZAP_RECEIPT_KIND) return null
  if (providerPubkey && receipt.pubkey !== providerPubkey) return null
  const description = receipt.tags.find((t) => t[0] === 'description')?.[1]
  const bolt11 = receipt.tags.find((t) => t[0] === 'bolt11')?.[1]
  if (!description || !bolt11 || validateZapRequest(description) !== null) return null
  const request = JSON.parse(description) as Event
  const coordinate = request.tags.find((t) => t[0] === 'a')?.[1]
  const payee = request.tags.find((t) => t[0] === 'p')?.[1]
  if (!coordinate || !payee) return null
  let sats: number
  try {
    sats = getSatoshisAmountFromBolt11(bolt11)
  } catch {
    return null
  }
  return { coordinate, payer: request.pubkey, payee, sats, at: receipt.created_at }
}

// --- Honor: did players pay the wagers they lost? ---

export interface FinishedGame {
  coordinate: string
  endedAt: number
  players: string[]
  /** Index of the winner, or null for a draw. */
  winner: number | null
  wager: number | null
}

export type HonorTier = 'gold' | 'silver' | 'bronze' | 'new' | 'red'

export interface Honor {
  tier: HonorTier
  /** Lost wagers paid. */
  paid: number
  /** Different players those payments went to. */
  winnersPaid: number
  /** Lost wagers more than the grace period overdue. */
  unpaid: number
  /** Lost wagers still inside the grace period. */
  pending: number
  /** How long the oldest unpaid wager has been overdue, in seconds (0 if none). */
  overdueFor: number
}

/** Paid wagers to this many different winners earn each tier (different winners, so trading 1-sat wagers with one friend can't farm it). */
export const HONOR_TIERS: [HonorTier, number][] = [
  ['gold', 25],
  ['silver', 10],
  ['bronze', 1],
]

/**
 * Honor for `pubkey` from their finished games and the wager payments seen.
 * Red means they owe a wager more than 24 hours overdue, and clears as soon as it's paid.
 * Otherwise the tier comes from how many different winners they've paid; someone who
 * hasn't lost a wager yet is "new".
 */
export function computeHonor(pubkey: string, games: FinishedGame[], payments: WagerPayment[], now: number): Honor {
  let paid = 0
  let unpaid = 0
  let pending = 0
  let overdueFor = 0
  const winners = new Set<string>()
  for (const g of games) {
    const me = g.players.indexOf(pubkey)
    if (!g.wager || me < 0 || g.winner === null || g.winner === me) continue
    const winner = g.players[g.winner]
    if (payments.some((p) => p.payer === pubkey && p.coordinate === g.coordinate && p.payee === winner && p.sats >= g.wager!)) {
      paid += 1
      winners.add(winner)
    } else if (now - g.endedAt > PAYMENT_GRACE_SECONDS) {
      unpaid += 1
      overdueFor = Math.max(overdueFor, now - g.endedAt - PAYMENT_GRACE_SECONDS)
    } else {
      pending += 1
    }
  }
  const tier = unpaid > 0 ? 'red' : (HONOR_TIERS.find(([, needed]) => winners.size >= needed)?.[0] ?? 'new')
  return { tier, paid, winnersPaid: winners.size, unpaid, pending, overdueFor }
}
