import { AnimatePresence, motion } from 'motion/react'
import { Check, Pickaxe, X } from 'lucide-react'
import { Button } from '../../components/ui'
import { SpriteView } from '../../components/Sprite'
import type { Sprite, SpriteMood } from '../../lib/sprites'
import { sats } from './share'
import { blocked, minerFees, type MinerDeal, type MinerMove, type MinerState, type Tx } from './rules'

/** How many waiting transactions you can see behind the one on offer. */
const PEEK = 2

const rate = (tx: Tx) => tx.fee / tx.vsize
const rateText = (tx: Tx) => `${rate(tx) < 10 ? rate(tx).toFixed(1) : Math.round(rate(tx))} sat/vB`

/** The stream's middle fee rate: what counts as a good or poor payer today. */
function medianRate(deal: MinerDeal): number {
  const rates = deal.stream.map(rate).sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)] ?? 0
}

/** Colour by fee rate against today's middle: rich payers glow. */
function tone(deal: MinerDeal, tx: Tx): string {
  const r = rate(tx) / (medianRate(deal) || 1)
  return r >= 2 ? 'bg-lemon/20 ring-lemon/60 text-lemon' : r >= 1 ? 'bg-mint/15 ring-mint/50 text-mint' : 'bg-white/5 ring-white/15 text-white/60'
}

/** The cheerleader: pondering the offer, pleased with a rich take, glum when the block is full. */
function moodFor(deal: MinerDeal, state: MinerState): SpriteMood {
  if (blocked(deal, state, state.next) === 'full') return 'sad'
  const last = state.taken.at(-1)
  if (last !== undefined && last === state.next - 1 && rate(deal.stream[last]) >= medianRate(deal)) return 'happy'
  return 'thinking'
}

/** The run in progress: the transaction on offer, the ones behind it, and your block filling up. */
export function MinerBoard({ deal, state, sprite, onMove }: { deal: MinerDeal; state: MinerState; sprite: Sprite; onMove(move: MinerMove): void }) {
  const at = state.next
  const tx = deal.stream[at]
  const why = blocked(deal, state, at)
  const left = deal.capacity - state.used

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-center">
        <Stat label="Your fees" value={sats(state.fees)} />
        <Stat label="Miner's fees" value={sats(minerFees(deal, at))} />
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-white/50">
          <span>Your block</span>
          <span aria-label="Block space">
            {state.used.toLocaleString('en-US')} of {deal.capacity.toLocaleString('en-US')} vB
          </span>
        </div>
        {/* Each transaction taken, as wide as its share of the block. */}
        <div className="flex h-6 overflow-hidden rounded-xl bg-night-950/60 ring-1 ring-white/10" role="img" aria-label={`Your block is ${Math.round((state.used / deal.capacity) * 100)}% full`}>
          {state.taken.map((i) => (
            <motion.div
              key={i}
              initial={{ width: 0 }}
              animate={{ width: `${(deal.stream[i].vsize / deal.capacity) * 100}%` }}
              className={`h-full border-r border-night-950 ring-1 ring-inset ${tone(deal, deal.stream[i])}`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SpriteView sprite={sprite} mood={moodFor(deal, state)} size={64} />
        <p className="flex-1 text-sm text-white/60" aria-live="polite">
          Transaction {at + 1}. The block could be found any moment <Pickaxe className="inline size-4 text-lemon" />
        </p>
      </div>

      <section aria-label="Mempool" className="flex flex-col gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={at} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ x: -40, opacity: 0, transition: { duration: 0.12 } }} className="relative z-0">
            <TxCard deal={deal} state={state} at={at} current />
          </motion.div>
        </AnimatePresence>
        {deal.stream.slice(at + 1, at + 1 + PEEK).map((_, k) => (
          <TxCard key={at + 1 + k} deal={deal} state={state} at={at + 1 + k} />
        ))}
      </section>

      <p className="min-h-5 text-center text-sm text-tangerine">
        {why === 'full' && `It doesn't fit: ${left.toLocaleString('en-US')} vB left.`}
        {why === 'parent' && `It spends from #${tx.parent! + 1}, which isn't in your block.`}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" icon={<X className="size-5" />} onClick={() => onMove('pass')}>
          Pass
        </Button>
        <Button icon={<Check className="size-5" />} disabled={why !== null} onClick={() => onMove('take')}>
          Take
        </Button>
      </div>
    </div>
  )
}

/** One waiting transaction: what it pays, its size, and its parent if it has one in the stream. */
function TxCard({ deal, state, at, current = false }: { deal: MinerDeal; state: MinerState; at: number; current?: boolean }) {
  const tx = deal.stream[at]
  const parentIn = tx.parent !== undefined && state.taken.includes(tx.parent)
  return (
    <div
      aria-label={current ? 'On offer' : `Waiting: #${at + 1}`}
      className={`flex items-center gap-3 rounded-2xl px-4 ring-1 ${tone(deal, tx)} ${current ? 'py-4' : 'py-2 opacity-60'}`}
    >
      <span className="w-8 font-display text-white/50">#{at + 1}</span>
      <div className="min-w-0 flex-1">
        <p className={`font-display ${current ? 'text-2xl' : 'text-base'}`}>{sats(tx.fee)}</p>
        <p className="text-xs text-white/60">
          {tx.vsize.toLocaleString('en-US')} vB · {rateText(tx)}
        </p>
      </div>
      {tx.parent !== undefined && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${parentIn ? 'bg-mint/20 text-mint' : 'bg-white/10 text-white/60'}`}>
          child of #{tx.parent + 1} {parentIn ? '✓' : ''}
        </span>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-night-950/60 py-2">
      <p className="text-xs font-semibold tracking-wider text-white/50 uppercase">{label}</p>
      <p className="text-xl font-display" aria-label={label}>
        {value}
      </p>
    </div>
  )
}
