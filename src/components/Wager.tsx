import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'
import { ShieldAlert, TriangleAlert, Zap } from 'lucide-react'
import { BIG_WAGER, DEFAULT_WAGER, MAX_WAGER, MIN_WAGER, SLIDER_STEPS, formatSats, satsFromSlider, sliderFromSats } from '../lib/wager'
import { useZappable } from '../hooks/useZappable'

/** The honor-system and beta warnings, louder for stakes over 100 sats. */
export function WagerWarning({ sats }: { sats: number }) {
  const big = sats > BIG_WAGER
  return (
    <div className={`flex gap-2 rounded-2xl p-3 text-sm ${big ? 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/50' : 'bg-tangerine/10 text-tangerine'}`}>
      {big ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
      <div className="flex flex-col gap-1.5">
        <p>
          <b>Honor system.</b> Nobody holds the stake: the loser is trusted to zap the winner afterwards, and nothing makes them pay.
          Don't set a wager you'd mind losing or never seeing.
        </p>
        <p>
          <b>Only wager where it’s legal for you.</b> Betting on games is restricted or illegal in many places, including many US states.
        </p>
        <p>Silvamor is beta software. It may have bugs, games can be lost to glitches, and payments can fail or go missing.</p>
        {big && (
          <p className="font-semibold">
            This is meant for friendly wagers only. Please don't place unnecessarily large wagers, and think twice before wagering with
            someone you don't know.
          </p>
        )}
      </div>
    </div>
  )
}

export function NoLightningAddress({ who = 'You need' }: { who?: string }) {
  return (
    <p className="flex gap-2 rounded-2xl bg-white/5 p-3 text-sm text-white/70">
      <Zap className="mt-0.5 size-4 shrink-0 text-lemon" />
      <span>
        {who} a Lightning address that accepts zaps on {who === 'You need' ? 'your' : 'their'} profile, so the winner can be paid and
        everyone can see it.{' '}
        {who === 'You need' && (
          <Link to="/profile" className="font-semibold text-mint hover:underline">
            Add one on your profile
          </Link>
        )}
      </span>
    </p>
  )
}

/** The "Wager" toggle with a logarithmic slider (1 sat … 1 BTC) and an exact amount box. */
export function WagerField({
  pubkey,
  value,
  onChange,
  legal,
  onLegal,
}: {
  pubkey: string
  value: number | null
  onChange(sats: number | null): void
  /** The creator confirmed wagering is legal where they live. */
  legal: boolean
  onLegal(ok: boolean): void
}) {
  const canReceive = useZappable(pubkey)
  const [text, setText] = useState(String(value ?? DEFAULT_WAGER))
  const set = (sats: number) => {
    onChange(sats)
    setText(String(sats))
  }
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          aria-label="Wager"
          checked={value !== null}
          onChange={(e) => (e.target.checked ? set(DEFAULT_WAGER) : onChange(null))}
          className="size-5 accent-lemon"
        />
        <span className="flex items-center gap-1.5 text-sm font-medium text-white/80">
          <Zap className="size-4 text-lemon" /> Wager
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/60 uppercase">beta</span>
      </label>
      <AnimatePresence initial={false}>
        {value !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 flex flex-col gap-3 overflow-hidden"
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                aria-label="Wager amount"
                min={0}
                max={SLIDER_STEPS}
                value={sliderFromSats(value)}
                onChange={(e) => set(satsFromSlider(Number(e.target.value)))}
                className="min-w-0 flex-1 accent-lemon"
              />
              <label className="flex items-center gap-1.5 rounded-xl bg-night-800 px-3 py-2 ring-1 ring-white/10 focus-within:ring-lemon">
                <input
                  inputMode="numeric"
                  aria-label="Wager in sats"
                  value={text}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '')
                    setText(digits)
                    const n = Number(digits)
                    if (digits) onChange(Math.min(MAX_WAGER, Math.max(MIN_WAGER, n)))
                  }}
                  onBlur={() => setText(String(value))}
                  className="w-24 bg-transparent text-right font-semibold outline-none"
                />
                <span className="text-sm text-white/50">sats</span>
              </label>
            </div>
            <p className="-mt-1 text-xs text-white/45">
              {formatSats(value)} to the winner, paid by the loser as a zap. Network fees not included.
            </p>
            <WagerWarning sats={value} />
            {canReceive === false && <NoLightningAddress />}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white/5 p-3 text-sm">
              <input type="checkbox" checked={legal} onChange={(e) => onLegal(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-lemon" />
              <span>
                Wagering on games is legal where I live, and I accept the{' '}
                <Link to="/terms" target="_blank" className="font-semibold text-mint hover:underline">
                  terms
                </Link>{' '}
                for wagers.
              </span>
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
