import { useEffect, useRef, useState } from 'react'
import type { Event } from 'nostr-tools/pure'
import { CheckCircle2, Clock, Zap } from 'lucide-react'
import { pool } from '../lib/nostr/pool'
import type { GameListing } from '../lib/nostr/gameEvents'
import { PAYMENT_GRACE_SECONDS, ZAP_RECEIPT_KIND, fetchLnurlPay, formatSats, paymentFromReceipt } from '../lib/wager'
import { autoPayOn } from '../lib/payments'
import { gameReadRelays } from '../stores/relays'
import { useProfile, useProfiles } from '../stores/profiles'
import { useSigner } from '../stores/session'
import { useHonor } from '../stores/honor'
import { useDisplayName } from '../hooks/useDisplayName'
import { PayButtons } from './ZapPay'
import { useZapPay } from '../hooks/useZapPay'

/** Set once this browser has paid (or started paying) a wager, so auto-pay never pays twice. */
const paidKey = (coordinate: string) => `silvamor:wager-paid:${coordinate}`
const markedPaid = (coordinate: string) => {
  try {
    return !!localStorage.getItem(paidKey(coordinate))
  } catch {
    return false
  }
}

/** Valid zap receipts paying this game's wager from the loser to the winner. */
function useWagerPaid(listing: GameListing, loser: string, winner: string) {
  const lud16 = useProfile(winner)?.lud16
  const [provider, setProvider] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<Event[]>([])
  useEffect(() => {
    useProfiles.getState().fetch(winner)
  }, [winner])
  useEffect(() => {
    if (lud16) fetchLnurlPay(lud16).then((l) => setProvider(l.nostrPubkey ?? null), () => setProvider(null))
  }, [lud16])
  useEffect(() => {
    const sub = pool.subscribe(gameReadRelays(), { kinds: [ZAP_RECEIPT_KIND], '#a': [listing.coordinate] }, {
      onevent: (e) => setReceipts((list) => (list.some((r) => r.id === e.id) ? list : [...list, e])),
    })
    return () => sub.close()
  }, [listing.coordinate])
  return receipts.some((r) => {
    const p = paymentFromReceipt(r, provider)
    return p && p.coordinate === listing.coordinate && p.payer === loser && p.payee === winner && p.sats >= listing.wager!
  })
}

/** After a wager game: the loser pays, everyone sees whether it was paid. */
export function WagerPanel({ listing, players, winner, endedAt }: { listing: GameListing; players: string[]; winner: number | null; endedAt: number }) {
  const sats = listing.wager!
  if (winner === null) {
    return (
      <Panel>
        <Zap className="size-5 shrink-0 text-lemon" />
        <span>It's a draw, so nobody owes the {formatSats(sats)} wager.</span>
      </Panel>
    )
  }
  return <Owed listing={listing} sats={sats} winner={players[winner]} loser={players[1 - winner]} endedAt={endedAt} />
}

function Owed({ listing, sats, winner, loser, endedAt }: { listing: GameListing; sats: number; winner: string; loser: string; endedAt: number }) {
  const { pubkey } = useSigner()
  const paid = useWagerPaid(listing, loser, winner)
  const winnerName = useDisplayName(winner)
  const loserName = useDisplayName(loser)
  const autoTried = useRef(false)
  const [openedAt] = useState(() => Date.now() / 1000)
  const overdue = openedAt - endedAt > PAYMENT_GRACE_SECONDS
  const zap = useZapPay({
    recipient: winner,
    sats,
    coordinate: listing.coordinate,
    content: `Silvamor wager: ${listing.title ?? 'game'}`,
    onPaying: () => localStorage.setItem(paidKey(listing.coordinate), String(Date.now())),
    successText: `Paid ${formatSats(sats)} to ${winnerName}. Thanks for playing fair! ⚡`,
  })

  useEffect(() => {
    // A newly paid wager changes the loser's honor; look again.
    if (paid) useHonor.getState().fetch(loser, true)
  }, [paid, loser])

  // Auto-pay through a connected wallet, once, if the player turned it on.
  const isLoser = pubkey === loser
  useEffect(() => {
    if (!isLoser || paid || autoTried.current || !autoPayOn(pubkey) || markedPaid(listing.coordinate)) return
    autoTried.current = true
    void zap.pay('nwc')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoser, paid, pubkey, listing.coordinate])

  if (paid) {
    return (
      <Panel tone="good">
        <CheckCircle2 className="size-5 shrink-0" />
        <span>
          Wager paid: {loserName} zapped {winnerName} {formatSats(sats)}.
        </span>
      </Panel>
    )
  }

  if (isLoser) {
    return (
      <div className="flex flex-col gap-3 rounded-3xl bg-lemon/10 p-4 ring-1 ring-lemon/30">
        <p className="flex items-center gap-2 font-semibold text-lemon">
          <Zap className="size-5 shrink-0" /> You owe {winnerName} {formatSats(sats)}
        </p>
        <p className="text-sm text-white/65">
          You agreed to this wager. Pay it with a zap so everyone can see you're good for it.
          {overdue ? ' It is overdue and counts against your honor badge until paid.' : ' Unpaid after 24 hours, it counts against your honor badge.'}
        </p>
        {markedPaid(listing.coordinate) && (
          <p className="text-xs text-white/50">You've paid from this device already; waiting for the receipt to show up. Only pay again if your wallet says it failed.</p>
        )}
        <PayButtons zap={zap} />
      </div>
    )
  }

  return (
    <Panel tone={overdue ? 'bad' : undefined}>
      <Clock className="size-5 shrink-0" />
      <span>
        {overdue
          ? `${loserName} hasn't paid the ${formatSats(sats)} wager yet.`
          : pubkey === winner
            ? `Waiting for ${loserName} to zap you ${formatSats(sats)}.`
            : `Waiting for ${loserName} to pay ${winnerName} the ${formatSats(sats)} wager.`}
      </span>
    </Panel>
  )
}

function Panel({ tone, children }: { tone?: 'good' | 'bad'; children: React.ReactNode }) {
  const colors = tone === 'good' ? 'bg-mint/10 text-mint' : tone === 'bad' ? 'bg-rose-500/15 text-rose-200' : 'bg-white/5 text-white/70'
  return <p className={`flex items-center gap-2 rounded-2xl p-3 text-sm ${colors}`}>{children}</p>
}
