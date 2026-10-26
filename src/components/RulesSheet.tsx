import { useState } from 'react'
import { BookOpen, Timer, X, Zap } from 'lucide-react'
import { RULES_TEXT } from '../games/rulesText'
import { rulesFor } from '../games/registry'
import type { GameListing } from '../lib/nostr/gameEvents'
import { blocksToApproxTime } from '../lib/bitcoin'
import { PAYMENT_GRACE_SECONDS, formatSats } from '../lib/wager'
import { Modal } from './Modal'
import { FEATURES } from '../features'

/** The book button in a game's header: opens the rules for this game and its settings. */
export function RulesButton({ listing }: { listing: GameListing }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Rules">
        <BookOpen className="size-5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <RulesSheet listing={listing} onClose={() => setOpen(false)} />
      </Modal>
    </>
  )
}

function RulesSheet({ listing, onClose }: { listing: GameListing; onClose(): void }) {
  const rules = rulesFor(listing.game, listing.options)
  const text = RULES_TEXT[listing.game]
  const size = listing.options.size
  return (
    <div className="flex flex-col gap-5 text-sm text-white/75">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display text-white">
          {rules?.emoji} {rules?.name ?? listing.game} rules
        </h2>
        <button onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close rules">
          <X className="size-5" />
        </button>
      </div>

      {text && (
        <section className="flex flex-col gap-2">
          <p className="font-semibold text-white">{text.goal}</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            {text.howToPlay.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {size && (
              <li>
                This game is played on a {size}×{size} board.
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 font-semibold text-white">
          <Timer className="size-4 text-lemon" /> Turn clock
        </h3>
        {listing.blocks ? (
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              This game gives {listing.blocks} Bitcoin block{listing.blocks === 1 ? '' : 's'} per turn, about {blocksToApproxTime(listing.blocks)}.
              Blocks come about every 10 minutes on average, but sometimes much faster or slower.
            </li>
            <li>The clock starts when the host lets the challenger in, and after each move it starts again for the next player.</li>
            {text && <li>{text.timeout}</li>}
            <li>Three strikes and you lose the game.</li>
            <li>Anyone watching can record a strike once its block is mined, so the clock keeps running even if a player goes quiet.</li>
          </ul>
        ) : (
          <p>This game has no turn clock: nobody can lose on time, but a game can stall if someone walks away.</p>
        )}
        <p>Resigning ends the game at once and gives your opponent the win.</p>
      </section>

      {FEATURES.wagers && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 font-semibold text-white">
            <Zap className="size-4 text-lemon" /> Wager
          </h3>
          {listing.wager ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>
                This game has a friendly wager of {formatSats(listing.wager)}. Whoever loses (by the rules, resigning or strikes) zaps the winner that
                amount. Network fees aren’t included. A draw pays nothing.
              </li>
              <li>It’s an honor system: nobody holds the stake, and nothing forces the loser to pay.</li>
              <li>
                Payments show up as zap receipts. A lost wager still unpaid {PAYMENT_GRACE_SECONDS / 3600} hours after the game turns the loser’s
                honor badge red until it’s paid.
              </li>
              <li>Silvamor is beta software: games can be lost to glitches and payments can fail. Keep wagers small and friendly.</li>
            </ul>
          ) : (
            <p>No wager on this game: it’s just for fun.</p>
          )}
        </section>
      )}
    </div>
  )
}
