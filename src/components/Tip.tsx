import { useState } from 'react'
import { Zap } from 'lucide-react'
import { formatSats } from '../lib/wager'
import { useZapPay } from '../hooks/useZapPay'
import { useZappable } from '../hooks/useZappable'
import { useDisplayName } from '../hooks/useDisplayName'
import { PayButtons } from './ZapPay'
import { Button } from './ui'

/** Thank-you tips are small: the post-game prompt always offers this flat amount. */
export const THANKS_TIP = 21
export const MAX_TIP = 1_000_000

/**
 * A tip to a player: a plain zap to them, deliberately not tied to any game or result.
 * `amount` fixes the tip; without it the tipper can change it (starting at 21 sats).
 */
export function TipButton({ pubkey, amount, label }: { pubkey: string; amount?: number; label?: string }) {
  const name = useDisplayName(pubkey)
  const canReceive = useZappable(pubkey)
  const [sats, setSats] = useState(amount ?? THANKS_TIP)
  const [text, setText] = useState(String(amount ?? THANKS_TIP))
  const [open, setOpen] = useState(false)

  if (canReceive === false) return <p className="text-xs text-white/45">{name} has no Lightning address that takes tips.</p>
  if (!open) {
    return (
      <Button variant="secondary" icon={<Zap className="size-4 text-lemon" />} disabled={canReceive === undefined} onClick={() => setOpen(true)}>
        {label ?? `Tip ${name} ${formatSats(sats)}`}
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {amount === undefined && (
        <label className="flex items-center gap-2 text-sm text-white/70">
          Amount
          <span className="flex items-center gap-1.5 rounded-xl bg-night-800 px-3 py-2 ring-1 ring-white/10 focus-within:ring-lemon">
            <input
              inputMode="numeric"
              aria-label="Tip in sats"
              value={text}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '')
                setText(digits)
                if (digits) setSats(Math.min(MAX_TIP, Math.max(1, Number(digits))))
              }}
              onBlur={() => setText(String(sats))}
              className="w-24 bg-transparent text-right font-semibold outline-none"
            />
            <span className="text-white/50">sats</span>
          </span>
        </label>
      )}
      {/* A fresh invoice for each amount. */}
      <TipPay key={sats} pubkey={pubkey} sats={sats} name={name} />
    </div>
  )
}

function TipPay({ pubkey, sats, name }: { pubkey: string; sats: number; name: string }) {
  const zap = useZapPay({
    recipient: pubkey,
    sats,
    content: 'A thank-you tip from Silvamor ⚡',
    successText: `Tipped ${name} ${formatSats(sats)} ⚡`,
  })
  return <PayButtons zap={zap} label="Tip" />
}
