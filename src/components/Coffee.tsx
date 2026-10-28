import { useState } from 'react'
import { Coffee } from 'lucide-react'
import { formatSats } from '../lib/zaps'
import { useLightningPay } from '../hooks/useZapPay'
import { Modal } from './Modal'
import { PayButtons } from './ZapPay'
import { MAX_TIP } from './Tip'

/** Where coffee money goes: VITE_COFFEE_ADDRESS changes it, and an empty value hides the button. */
const COFFEE_ADDRESS: string = import.meta.env.VITE_COFFEE_ADDRESS ?? 'silvamor@strike.me'
/** About a coffee's worth; the player can change it. */
const COFFEE_SATS = 2_100

/**
 * "Buy me a coffee": a plain Lightning payment to Silvamor's maker, from a popup. `compact` is the
 * phone header's icon; otherwise it's the sidebar's text link.
 */
export function CoffeeButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!COFFEE_ADDRESS) return null
  return (
    <>
      {compact ? (
        <button onClick={() => setOpen(true)} aria-label="Buy me a coffee" title="Buy me a coffee" className="block size-6 text-white/40 transition-colors hover:text-white">
          <Coffee className="size-6" />
        </button>
      ) : (
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-3 text-sm text-white/50 transition-colors hover:text-white">
          <Coffee className="size-4 text-lemon" /> Buy me a coffee
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)}>
        {open && <CoffeeForm />}
      </Modal>
    </>
  )
}

function CoffeeForm() {
  const [sats, setSats] = useState(COFFEE_SATS)
  const [text, setText] = useState(String(COFFEE_SATS))
  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-xl font-display">
        <Coffee className="size-6 text-lemon" /> Buy me a coffee
      </h2>
      <p className="text-sm text-white/60">Silvamor is free and ad-free. A coffee keeps the relay running and new games coming.</p>
      <label className="flex items-center gap-2 text-sm text-white/70">
        Amount
        <span className="flex items-center gap-1.5 rounded-xl bg-night-800 px-3 py-2 ring-1 ring-white/10 focus-within:ring-lemon">
          <input
            inputMode="numeric"
            aria-label="Coffee in sats"
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
      {/* A fresh invoice for each amount. */}
      <CoffeePay key={sats} sats={sats} />
    </div>
  )
}

function CoffeePay({ sats }: { sats: number }) {
  const pay = useLightningPay({ address: COFFEE_ADDRESS, sats, comment: 'A coffee from a Silvamor player ☕', successText: `Thank you for the coffee! ☕ (${formatSats(sats)})` })
  return <PayButtons zap={pay} label="Pay" />
}
