import type { Event, EventTemplate } from 'nostr-tools/pure'

// Tips: zaps (NIP-57) to players and sprite artists, paid from the player's own wallet; and
// plain Lightning payments (buying Silvamor a coffee).

const ZAP_REQUEST_KIND = 9734

/** "21 sats" up to 9,999; then 10k, 464k, 1M, 1.3M, 11M, 45M, 1BTC. */
export function formatSats(sats: number): string {
  if (sats < 10_000) return `${sats.toLocaleString('en-US')} ${sats === 1 ? 'sat' : 'sats'}`
  if (sats < 1_000_000) return `${Math.floor(sats / 1000)}k`
  if (sats < 10_000_000) return `${Math.floor(sats / 100_000) / 10}M`
  if (sats < 100_000_000) return `${Math.floor(sats / 1_000_000)}M`
  return `${Math.floor(sats / 10_000_000) / 10}BTC`
}

// --- Paying: Lightning addresses (LNURL-pay) and zaps ---

export interface LnurlPay {
  callback: string
  minSendable: number
  maxSendable: number
  allowsNostr?: boolean
  /** Signs this provider's zap receipts. */
  nostrPubkey?: string
  /** How long a comment a plain payment may carry (LUD-12). */
  commentAllowed?: number
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
 * given (a sprite). Without one it's a plain zap to the person, as tips to players are.
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

/** Asks the recipient's Lightning provider for an invoice paying the signed zap request. */
export function requestZapInvoice(lnurl: LnurlPay, zapRequest: Event, sats: number): Promise<string> {
  return requestInvoice(lnurl, sats, { nostr: JSON.stringify(zapRequest) })
}

/** Asks a Lightning address for a plain invoice, not a zap, with a comment if it takes one. */
export function requestPlainInvoice(lnurl: LnurlPay, sats: number, comment: string): Promise<string> {
  const max = lnurl.commentAllowed ?? 0
  return requestInvoice(lnurl, sats, max > 0 && comment ? { comment: comment.slice(0, max) } : {})
}

async function requestInvoice(lnurl: LnurlPay, sats: number, params: Record<string, string>): Promise<string> {
  const msat = sats * 1000
  if (msat < lnurl.minSendable || msat > lnurl.maxSendable) {
    throw new Error(`Their wallet accepts ${formatSats(Math.ceil(lnurl.minSendable / 1000))} to ${formatSats(Math.floor(lnurl.maxSendable / 1000))}.`)
  }
  const url = new URL(lnurl.callback)
  url.searchParams.set('amount', String(msat))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url)
  const data = (await res.json().catch(() => ({}))) as { pr?: string; reason?: string }
  if (!res.ok || !data.pr) throw new Error(data.reason ?? "Their wallet didn't return an invoice.")
  return data.pr
}
