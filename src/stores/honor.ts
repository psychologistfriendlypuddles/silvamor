import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { pool } from '../lib/nostr/pool'
import { GAME_ACTION_KIND, GAME_LISTING_KIND, parseAction, parseListing, type GameListing } from '../lib/nostr/gameEvents'
import { replay } from '../lib/replay'
import { ZAP_RECEIPT_KIND, computeHonor, fetchLnurlPay, paymentFromReceipt, type FinishedGame, type Honor, type WagerPayment } from '../lib/wager'
import { rulesFor } from '../games/registry'
import { useBlocks } from './blocks'
import { useProfiles } from './profiles'
import { gameReadRelays } from './relays'

const STALE_AFTER = 10 * 60 * 1000
/** Gold looks at the last 1000 games. */
const HISTORY_LIMIT = 1000
/** Players whose history is fetched at once; the rest wait their turn. */
const CONCURRENCY = 2

interface HonorState {
  records: Record<string, { honor: Honor; fetchedAt: number }>
  pending: Record<string, boolean>
  fetch(pubkey: string, force?: boolean): void
}

async function chunked(filter: (chunk: string[]) => Parameters<typeof pool.querySync>[1], items: string[]): Promise<Event[]> {
  const out: Event[] = []
  for (let i = 0; i < items.length; i += 100) out.push(...(await pool.querySync(gameReadRelays(), filter(items.slice(i, i + 100)), { maxWait: 5000 })))
  return out
}

/** The receipts' signer for a winner: their Lightning provider (null if it can't be looked up). */
export async function providerOf(pubkey: string): Promise<string | null> {
  await useProfiles.getState().fetch(pubkey)
  const lud16 = useProfiles.getState().profiles[pubkey]?.content.lud16
  if (typeof lud16 !== 'string') return null
  return fetchLnurlPay(lud16).then((l) => l.nostrPubkey ?? null, () => null)
}

/** Every client works honor out itself from games and zap receipts anyone can check. */
async function loadHonor(pubkey: string): Promise<Honor> {
  const listingEvents = await pool.querySync(gameReadRelays(), { kinds: [GAME_LISTING_KIND], '#p': [pubkey], limit: HISTORY_LIMIT }, { maxWait: 5000 })
  const listings = new Map<string, GameListing>()
  for (const e of listingEvents) {
    const l = parseListing(e)
    if (!l?.startId || !l.pubkeys.includes(pubkey) || !rulesFor(l.game, l.options)) continue
    if ((listings.get(l.coordinate)?.createdAt ?? 0) < l.createdAt) listings.set(l.coordinate, l)
  }
  const coords = [...listings.keys()]
  const actions = await chunked((chunk) => ({ kinds: [GAME_ACTION_KIND], '#a': chunk }), coords)
  const byGame = new Map<string, Event[]>()
  for (const e of actions) {
    const a = e.tags.find((t) => t[0] === 'a')?.[1]
    if (a) byGame.set(a, [...(byGame.get(a) ?? []), e])
  }

  const height = useBlocks.getState().height
  const games: FinishedGame[] = []
  for (const l of listings.values()) {
    const result = replay(rulesFor(l.game, l.options)!, l.host, (byGame.get(l.coordinate) ?? []).map((e) => parseAction(e)), {
      blocks: l.blocks,
      knownHeight: height,
    })
    if (!result.started || !result.outcome || !result.tip) continue
    const o = result.outcome
    games.push({ coordinate: l.coordinate, endedAt: result.tip.createdAt, players: result.players, winner: 'draw' in o ? null : o.winner, wager: l.wager })
  }

  // Payments for the wagers this player lost, checked against each winner's Lightning provider.
  const lost = games.filter((g) => g.wager && g.winner !== null && g.players[g.winner] !== pubkey)
  const receipts = await chunked((chunk) => ({ kinds: [ZAP_RECEIPT_KIND], '#a': chunk }), lost.map((g) => g.coordinate))
  const providers = new Map<string, string | null>()
  for (const winner of new Set(lost.map((g) => g.players[g.winner!]))) providers.set(winner, await providerOf(winner))
  const payments: WagerPayment[] = []
  for (const r of receipts) {
    const payee = r.tags.find((t) => t[0] === 'p')?.[1]
    const payment = payee ? paymentFromReceipt(r, providers.get(payee) ?? null) : null
    if (payment) payments.push(payment)
  }
  return computeHonor(pubkey, games, payments, Math.floor(Date.now() / 1000))
}

const queue: string[] = []
let running = 0

export const useHonor = create<HonorState>((set, get) => {
  const next = () => {
    while (running < CONCURRENCY && queue.length > 0) {
      const pubkey = queue.shift()!
      running++
      loadHonor(pubkey)
        .then((honor) => set({ records: { ...get().records, [pubkey]: { honor, fetchedAt: Date.now() } } }))
        .catch(() => {})
        .finally(() => {
          running--
          set({ pending: { ...get().pending, [pubkey]: false } })
          next()
        })
    }
  }
  return {
    records: {},
    pending: {},
    fetch(pubkey, force = false) {
      const cached = get().records[pubkey]
      if (get().pending[pubkey] || (!force && cached && Date.now() - cached.fetchedAt < STALE_AFTER)) return
      set({ pending: { ...get().pending, [pubkey]: true } })
      queue.push(pubkey)
      next()
    },
  }
})
