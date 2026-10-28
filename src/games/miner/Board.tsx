import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useTransform, type MotionValue, type PanInfo } from 'motion/react'
import { Check, X } from 'lucide-react'
import { SpriteView } from '../../components/Sprite'
import type { Sprite, SpriteMood } from '../../lib/sprites'
import { sats } from './share'
import { chatter } from './facts'
import { layoutBlock, roomFor, type Rect } from './blockLayout'
import { blocked, minerFees, minerMoves, type MinerDeal, type MinerMove, type MinerState, type Tx } from './rules'

/** How many waiting transactions you can see behind the one on offer. */
const PEEK = 2
/** How far (px) the card on offer must be swiped to decide: down takes it, up passes on it. */
const SWIPE = 60

// The swipe hint shows on touch screens until the player's first swipe.
const SWIPED_KEY = 'silvamor:miner-swiped'
function hasSwiped(): boolean {
  try {
    return localStorage.getItem(SWIPED_KEY) === 'yes'
  } catch {
    return true
  }
}
function markSwiped() {
  try {
    localStorage.setItem(SWIPED_KEY, 'yes')
  } catch {
    // Storage blocked: the hint just keeps showing.
  }
}

const rate = (tx: Tx) => tx.fee / tx.vsize
const rateText = (tx: Tx) => `${rate(tx) < 10 ? rate(tx).toFixed(1) : Math.round(rate(tx))} sat/vB`

/** The stream's middle fee rate: what counts as a good or poor payer today. */
function medianRate(deal: MinerDeal): number {
  const rates = deal.stream.map(rate).sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)] ?? 0
}

/**
 * A fee-rate colour, as block explorers draw them: purple for poor payers, through green, to yellow
 * for rich ones (a quarter of today's middle rate up to four times it).
 */
function colour(deal: MinerDeal, tx: Tx): string {
  const t = Math.min(1, Math.max(0, Math.log2(rate(tx) / (medianRate(deal) || 1)) / 4 + 0.5))
  return `hsl(${Math.round(265 - t * 215)} 75% 58%)`
}

/** The cheerleader: pondering the offer, pleased with a rich take, glum when the block is full. */
function moodFor(deal: MinerDeal, state: MinerState): SpriteMood {
  if (blocked(deal, state, state.next) === 'full') return 'sad'
  const last = state.taken.at(-1)
  if (last !== undefined && last === state.next - 1 && rate(deal.stream[last]) >= medianRate(deal)) return 'happy'
  return 'thinking'
}

/** The run in progress: the stream of transactions sliding in, and your block filling up. */
export function MinerBoard({ deal, state, sprite, onMove }: { deal: MinerDeal; state: MinerState; sprite: Sprite; onMove(move: MinerMove): void }) {
  const at = state.next
  const tx = deal.stream[at]
  const why = blocked(deal, state, at)
  const left = deal.capacity - state.used
  // Where the last card went: down into the block when taken, up and away when passed.
  const lastTaken = state.taken.at(-1) === at - 1

  // Swiping the card on offer: down takes it, up passes on it; a short swipe springs back.
  // `dragY` only follows the swipe, for the tint: the cards' own movement stays theirs, so a card
  // leaving the row can't move the next one.
  const dragY = useMotionValue(0)
  const offer = useRef<HTMLDivElement>(null)
  const [hint, setHint] = useState(() => !hasSwiped() && matchMedia('(pointer: coarse)').matches)
  const decide = (move: MinerMove) => {
    dragY.set(0)
    onMove(move)
  }
  const onDragEnd = (_: unknown, { offset, velocity }: PanInfo) => {
    dragY.set(0)
    const down = offset.y > SWIPE || (offset.y > 20 && velocity.y > 500)
    const up = offset.y < -SWIPE || (offset.y < -20 && velocity.y < -500)
    if (!down && !up) return
    markSwiped()
    setHint(false)
    if (up) return decide('pass')
    // Can't take it: a shake, and the reason shows below.
    if (why) return offer.current && void animate(offer.current, { x: [0, -10, 10, -6, 6, 0] }, { duration: 0.35 })
    decide('take')
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-center">
        <Stat label="Your fees" value={sats(state.fees)} />
        <Stat label="Miner's fees" value={sats(minerFees(deal, at))} />
      </div>

      {/* The sprite says the most interesting thing about the transaction on offer. */}
      <div className="flex items-center gap-3">
        <SpriteView sprite={sprite} mood={moodFor(deal, state)} size={56} />
        <motion.p
          key={at}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          aria-live="polite"
          aria-label="Your sprite says"
          className="relative flex-1 rounded-2xl rounded-bl-sm bg-night-950/70 px-3 py-2 text-sm break-words text-white/80 ring-1 ring-white/10"
        >
          <span className="font-display text-white/50">#{at + 1} </span>
          {chatter(tx.facts, rate(tx) / (medianRate(deal) || 1), tx.parent !== undefined ? tx.parent + 1 : undefined)}
        </motion.p>
      </div>

      {/* The stream, as on mempool.space: the one on offer, then the next ones sliding in from the side. */}
      <section aria-label="Mempool" className="-mx-3 -my-2 flex gap-2 overflow-x-clip px-3 py-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {deal.stream.slice(at, at + 1 + PEEK).map((_, k) => (
            <motion.div
              key={at + k}
              layout
              initial={{ x: 120, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ y: lastTaken ? 60 : -40, opacity: 0, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className={k === 0 ? 'z-10 min-w-0 flex-[2.2] cursor-grab touch-none active:cursor-grabbing' : 'min-w-0 flex-1'}
              {...(k === 0 && { drag: 'y' as const, dragConstraints: { top: 0, bottom: 0 }, dragElastic: 0.6, dragSnapToOrigin: true, onDrag: (_: unknown, info: PanInfo) => dragY.set(info.offset.y), onDragEnd })}
            >
              {k === 0 ? <TxCard deal={deal} state={state} at={at} onMove={decide} dragY={dragY} cardRef={offer} /> : <TxCard deal={deal} state={state} at={at + k} />}
            </motion.div>
          ))}
        </AnimatePresence>
      </section>
      <p className="-my-2 min-h-5 text-center text-sm text-tangerine">
        {why === 'full' && `It doesn't fit: ${left.toLocaleString('en-US')} vB left.`}
        {why === 'parent' && `It spends from #${tx.parent! + 1}, which isn't in your block.`}
        {!why && hint && <span className="text-white/50">Swipe down to take, up to pass</span>}
      </p>

      <BlockView deal={deal} state={state} />
      <MinerBar deal={deal} arrived={at} />
    </div>
  )
}

/**
 * Your block as a square whose area is its room: each transaction taken is a tile of exactly its
 * share of the area (largest first; tiles move as the block fills), the room left is exactly the
 * empty area, and the one on offer is outlined there at its size.
 */
function BlockView({ deal, state }: { deal: MinerDeal; state: MinerState }) {
  const { tiles, empty } = layoutBlock(
    state.taken.map((i) => ({ at: i, vsize: deal.stream[i].vsize })),
    deal.capacity,
  )
  const room = blocked(deal, state, state.next) === null ? roomFor(empty, deal.stream[state.next].vsize, deal.capacity) : null
  const place = (r: Rect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` })

  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-xs text-white/50">
        <span>Your block</span>
        <span aria-label="Block space">
          {state.used.toLocaleString('en-US')} of {deal.capacity.toLocaleString('en-US')} vB
        </span>
      </div>
      <div
        className="relative aspect-square w-full overflow-hidden rounded-lg bg-night-950/70 ring-1 ring-white/15"
        role="img"
        aria-label={`Your block is ${Math.round((state.used / deal.capacity) * 100)}% full`}
      >
        {tiles.map((t) => (
          <motion.div
            key={t.at}
            initial={{ opacity: 0, ...place(t) }}
            animate={{ opacity: 1, ...place(t) }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute p-px"
          >
            <div className="size-full rounded-[2px]" style={{ background: colour(deal, deal.stream[t.at]) }} />
          </motion.div>
        ))}
        {room && <div className="absolute rounded-[2px] border-2 border-dashed border-white/50" style={place(room)} />}
      </div>
    </div>
  )
}

/**
 * The miner's block as it fills, transaction by transaction, as wide as their share of its room.
 * Only the transactions you've already decided on: its choice on the one on offer would be a hint.
 */
function MinerBar({ deal, arrived }: { deal: MinerDeal; arrived: number }) {
  const taken = minerMoves(deal)
    .slice(0, arrived)
    .flatMap((m, i) => (m === 'take' ? [i] : []))
  const used = taken.reduce((sum, i) => sum + deal.stream[i].vsize, 0)
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-xs text-white/50">
        <span>The miner's block</span>
        <span aria-label="Miner's block space">
          {used.toLocaleString('en-US')} of {deal.capacity.toLocaleString('en-US')} vB
        </span>
      </div>
      <div
        className="flex h-5 overflow-hidden rounded-md bg-night-950/70 ring-1 ring-white/15"
        role="img"
        aria-label={`The miner's block is ${Math.round((used / deal.capacity) * 100)}% full`}
      >
        {taken.map((i) => (
          <motion.div
            key={i}
            initial={{ width: 0 }}
            animate={{ width: `${(deal.stream[i].vsize / deal.capacity) * 100}%` }}
            className="h-full border-r border-night-950"
            style={{ background: colour(deal, deal.stream[i]) }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * One waiting transaction: what it pays, its size, and its parent if it has one in the stream. The
 * one on offer (given `onMove`) glows and holds the ✗ and ✓ buttons.
 */
function TxCard({
  deal,
  state,
  at,
  onMove,
  dragY,
  cardRef,
}: {
  deal: MinerDeal
  state: MinerState
  at: number
  onMove?(move: MinerMove): void
  /** How far the card on offer is being swiped, to tint it: red going up (pass), green going down (take). */
  dragY?: MotionValue<number>
  cardRef?: RefObject<HTMLDivElement | null>
}) {
  const tx = deal.stream[at]
  const current = onMove !== undefined
  const still = useMotionValue(0)
  const passing = useTransform(dragY ?? still, [-SWIPE, 0], [1, 0])
  const taking = useTransform(dragY ?? still, [0, SWIPE], [0, 1])
  // A card on its way out keeps no buttons: a quick second tap mustn't land on it.
  const present = useIsPresent()
  // A swipe on the card on offer mustn't scroll the page too: phone browsers start scrolling (and
  // cancel the swipe) unless the touch's moves are refused.
  const root = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = root.current
    if (!current || !el) return
    const hold = (e: TouchEvent) => e.preventDefault()
    el.addEventListener('touchmove', hold, { passive: false })
    return () => el.removeEventListener('touchmove', hold)
  }, [current])
  const parentIn = tx.parent !== undefined && state.taken.includes(tx.parent)
  return (
    <div
      ref={(el) => {
        root.current = el
        if (cardRef) cardRef.current = el
      }}
      aria-label={current && present ? 'On offer' : `#${at + 1}`}
      className={`relative flex h-full gap-2 overflow-hidden rounded-xl border-t-4 bg-night-900/80 px-3 py-2 ${current ? 'shadow-[0_0_14px_2px_rgb(253_224_71/0.5)] ring-2 ring-lemon motion-safe:animate-glow' : 'opacity-60 ring-1 ring-white/10'}`}
      style={{ borderTopColor: colour(deal, tx) }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-display text-white/50">#{at + 1}</span>
        <span className={`font-display leading-tight ${current ? 'text-lg' : 'text-sm'}`}>{sats(tx.fee)}</span>
        <span className="text-xs text-white/60">{tx.vsize.toLocaleString('en-US')} vB</span>
        <span className="text-xs text-white/60">{rateText(tx)}</span>
        {tx.parent !== undefined && (
          <span className={`mt-1 self-start rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${parentIn ? 'bg-mint/20 text-mint' : 'bg-white/10 text-white/60'}`}>
            child of #{tx.parent + 1} {parentIn ? '✓' : ''}
          </span>
        )}
      </div>
      {current && (
        <>
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center bg-rose-500/35" style={{ opacity: passing }}>
            <X className="size-10 text-rose-200" strokeWidth={3} />
          </motion.div>
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/35" style={{ opacity: taking }}>
            <Check className="size-10 text-emerald-200" strokeWidth={3} />
          </motion.div>
        </>
      )}
      {/* The decision, on the right: pass on it (✗) or take it (✓). */}
      {onMove && present && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Choice label="Pass" onClick={() => onMove('pass')} className="bg-rose-500/20 text-rose-300 ring-rose-400/50 hover:bg-rose-500/35">
            <X className="size-5" strokeWidth={3} />
          </Choice>
          <Choice label="Take" disabled={blocked(deal, state, at) !== null} onClick={() => onMove('take')} className="bg-emerald-500/20 text-emerald-300 ring-emerald-400/50 hover:bg-emerald-500/35">
            <Check className="size-5" strokeWidth={3} />
          </Choice>
        </div>
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

/** A small square icon button: the red ✗ and green ✓. */
function Choice({ label, disabled = false, onClick, className, children }: { label: string; disabled?: boolean; onClick(): void; className: string; children: ReactNode }) {
  return (
    <motion.button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      className={`flex size-10 items-center justify-center rounded-lg ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${className}`}
    >
      {children}
    </motion.button>
  )
}
