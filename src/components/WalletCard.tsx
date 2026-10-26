import { useState } from 'react'
import { Unplug, Wallet } from 'lucide-react'
import { autoPayOn, isNwcConnection, saveNwc, savedNwc, setAutoPay } from '../lib/payments'
import { toast } from '../stores/toast'
import { Button, Card, Field } from './ui'
import { TIER_STYLE, honorSummary, useHonorOf } from '../hooks/useHonorOf'
import { FEATURES } from '../features'

const TIER_HELP: [keyof typeof TIER_STYLE, string][] = [
  ['gold', 'paid wagers to 25+ different players'],
  ['silver', 'paid wagers to 10+ different players'],
  ['bronze', 'paid every wager lost so far'],
  ['new', 'hasn’t lost a wager yet'],
  ['red', 'owes a wager over 24 hours late; paying clears it'],
]

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Your wager honor: how many lost wagers you paid, and what the badge colors mean. */
export function HonorCard({ pubkey }: { pubkey: string }) {
  const honor = useHonorOf(pubkey)
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {honor && <span className={`size-6 shrink-0 rounded-full ${TIER_STYLE[honor.tier].className}`} />}
        <div className="min-w-0">
          <p className="font-semibold">Wager honor{honor && `: ${TIER_STYLE[honor.tier].label}`}</p>
          <p className="text-sm text-white/55">
            {honor ? capitalize(honorSummary(honor)) : 'Checking your games…'}
            {honor && honor.pending > 0 && ` · ${honor.pending} due within 24 hours`}
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-1 text-xs text-white/50">
        {TIER_HELP.map(([tier, text]) => (
          <li key={tier} className="flex items-center gap-2">
            <span className={`size-3 shrink-0 rounded-full ${TIER_STYLE[tier].className}`} />
            <span>
              <b className="text-white/70">{TIER_STYLE[tier].label}</b>: {text}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-white/40">Worked out by every app from public games and zap receipts.</p>
    </Card>
  )
}

/** Connect a wallet (Nostr Wallet Connect) so lost wagers can be paid with one tap, or automatically. */
export function WalletCard({ pubkey }: { pubkey: string }) {
  const [connected, setConnected] = useState(() => !!savedNwc(pubkey))
  const [auto, setAuto] = useState(() => autoPayOn(pubkey))
  const [link, setLink] = useState('')
  const error = link && !isNwcConnection(link) ? 'Paste a nostr+walletconnect://… link from your wallet' : null

  const connect = () => {
    try {
      saveNwc(pubkey, link)
      setConnected(true)
      setLink('')
      toast.success('Wallet connected ⚡')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Wallet className="size-5 text-lemon" />
        <p className="font-semibold">Wallet</p>
      </div>
      {connected ? (
        <>
          <p className="text-sm text-white/55">
            A wallet is connected on this device (Nostr Wallet Connect). {FEATURES.wagers ? 'Tips and lost wagers' : 'Tips'} can be paid with one tap.
          </p>
          {FEATURES.wagers && (
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAutoPay(pubkey, e.target.checked)
                  setAuto(e.target.checked)
                }}
                className="size-5 accent-lemon"
              />
              Pay lost wagers automatically when I open the game
            </label>
          )}
          <Button
            variant="secondary"
            icon={<Unplug className="size-4" />}
            className="self-start"
            onClick={() => {
              saveNwc(pubkey, null)
              setConnected(false)
              setAuto(false)
            }}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-white/55">
            Optional. Paste a Nostr Wallet Connect link from your wallet (Alby Hub, Primal, Coinos, …) to pay{' '}
            {FEATURES.wagers ? 'tips and lost wagers' : 'tips'} with one tap. Give it a small budget: the link stays on this device but can spend up
            to that budget. Without one you can still pay by QR code.
          </p>
          <Field label="Connection link" placeholder="nostr+walletconnect://…" value={link} onChange={(e) => setLink(e.target.value)} error={error} />
          <Button variant="lemon" disabled={!link || !!error} className="self-start" onClick={connect}>
            Connect wallet
          </Button>
        </>
      )}
    </Card>
  )
}
