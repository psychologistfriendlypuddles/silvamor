import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Play, Shuffle } from 'lucide-react'
import { Button } from '../../components/ui'
import { SpriteView } from '../../components/Sprite'
import type { Sprite, SpriteMood } from '../../lib/sprites'
import {
  HAND_BASE,
  MAX_CARDS,
  RANKS,
  SUITS,
  cardName,
  perkText,
  rankOf,
  scorePlay,
  suitOf,
  type DailyDealMove,
  type HandType,
  type DailyDealState,
  type Play as Scored,
} from './rules'

const RED = new Set([1, 2])

type Sort = 'rank' | 'suit'
const byRank = (a: number, b: number) => rankOf(b) - rankOf(a) || suitOf(a) - suitOf(b)
const bySuit = (a: number, b: number) => suitOf(a) - suitOf(b) || rankOf(b) - rankOf(a)

/** Hands good enough to cheer for; a lone high card gets sympathy. */
const CHEERS: HandType[] = ['trips', 'straight', 'flush', 'fullhouse', 'quads', 'straightflush']

/** The cheerleader's mood: weighing up the picked cards, or reacting to the last hand. */
function moodFor(picking: boolean, last: DailyDealState['last']): SpriteMood {
  if (picking) return 'thinking'
  if (!last || !('play' in last)) return 'idle'
  return CHEERS.includes(last.play.hand) ? 'happy' : last.play.hand === 'high' ? 'sad' : 'idle'
}

/** The run in progress, with the player's sprite cheering them on. */
export function DailyDealBoard({ state, sprite, onMove }: { state: DailyDealState; sprite: Sprite; onMove(move: DailyDealMove): void }) {
  const [picked, setPicked] = useState<number[]>([])
  const [sort, setSort] = useState<Sort>('rank')
  // Cards that just left the hand drop out of the selection.
  const selected = picked.filter((c) => state.hand.includes(c))
  const hand = [...state.hand].sort(sort === 'rank' ? byRank : bySuit)
  const preview = selected.length > 0 ? scorePlay(selected, state.perks, state.handsLeft === 1) : null
  const active = state.handsLeft > 0

  const toggle = (card: number) =>
    setPicked(selected.includes(card) ? selected.filter((c) => c !== card) : selected.length < MAX_CARDS ? [...selected, card] : selected)
  const send = (move: DailyDealMove) => {
    setPicked([])
    onMove(move)
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Score" value={state.score.toLocaleString()} />
        <Stat label="Hands" value={state.handsLeft} />
        <Stat label="Discards" value={state.discardsLeft} />
      </div>

      <ul className="flex flex-col gap-1.5" aria-label="Today's perks">
        {state.perks.map((perk, i) => (
          <li key={i} className="rounded-2xl bg-grape/20 px-3 py-2 text-sm font-medium ring-1 ring-grape/40">
            ✨ {perkText(perk)}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <SpriteView sprite={sprite} mood={moodFor(selected.length > 0, state.last)} size={64} />
        <div className="min-h-14 flex-1 rounded-2xl bg-night-950/60 px-4 py-3 text-center" aria-live="polite">
          {preview ? <ScoreLine play={preview} /> : <LastMove state={state} />}
        </div>
      </div>

      {/* A fan: overlapping cards on a shallow arc, picked cards lifted out of it. */}
      <div className="flex justify-center px-4 pt-8 pb-5" role="group" aria-label="Your hand">
        <AnimatePresence initial={false} mode="popLayout">
          {hand.map((card, i) => {
            const on = selected.includes(card)
            const scoring = preview?.scoring.includes(card)
            const offset = i - (hand.length - 1) / 2
            return (
              <motion.button
                key={card}
                layout
                initial={{ opacity: 0, y: -40 }}
                animate={{ opacity: 1, rotate: offset * 4, y: offset * offset * 1.5 - (on ? 24 : 0) }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                style={{ transformOrigin: '50% 100%' }}
                aria-label={cardName(card)}
                aria-pressed={on}
                disabled={!active}
                onClick={() => toggle(card)}
                className={`relative -ml-5 flex aspect-[5/7] w-0 max-w-24 min-w-0 flex-1 flex-col items-center justify-center rounded-xl bg-white font-bold shadow-[-4px_0_10px_rgba(0,0,0,0.25)] first:ml-0 sm:-ml-8 ${
                  RED.has(suitOf(card)) ? 'text-rose-500' : 'text-night-900'
                } ${on ? (scoring ? 'ring-4 ring-lemon' : 'ring-4 ring-white/60') : ''} ${active ? 'cursor-pointer' : 'opacity-60'}`}
              >
                <span className="absolute top-1 left-1.5 text-sm leading-none sm:text-base">{RANKS[rankOf(card)]}</span>
                <span className="text-2xl leading-none sm:text-4xl">{SUITS[suitOf(card)]}</span>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className="px-3"
          icon={<Shuffle className="size-4" />}
          onClick={() => setSort(sort === 'rank' ? 'suit' : 'rank')}
          aria-label={sort === 'rank' ? 'Sort by suit' : 'Sort by rank'}
        />
        <Button
          variant="secondary"
          className="flex-1 px-3 whitespace-nowrap"
          disabled={!active || selected.length === 0 || state.discardsLeft === 0}
          onClick={() => send({ discard: selected })}
        >
          Discard
        </Button>
        <Button className="flex-1 px-3 whitespace-nowrap" icon={<Play className="size-4" />} disabled={!active || selected.length === 0} onClick={() => send({ play: selected })}>
          Play hand
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-night-950/60 py-2">
      <p className="text-xs font-semibold tracking-wider text-white/50 uppercase">{label}</p>
      <p className="text-2xl font-display" aria-label={label}>
        {value}
      </p>
    </div>
  )
}

/** "Pair · 22 × 6 = 132" */
export function ScoreLine({ play }: { play: Scored }) {
  return (
    <p className="font-semibold">
      {HAND_BASE[play.hand].name} · <span className="text-sky">{play.chips}</span> × <span className="text-bubblegum">{play.mult}</span> ={' '}
      <span className="text-lemon">{play.points.toLocaleString()}</span>
    </p>
  )
}

function LastMove({ state }: { state: DailyDealState }) {
  if (!state.last) return <p className="text-white/50">Pick up to {MAX_CARDS} cards to play or discard.</p>
  if ('discard' in state.last) return <p className="text-white/50">Discarded {state.last.discard.map(cardName).join(' ')}</p>
  return (
    <div className="text-white/70">
      <p className="text-xs tracking-wider text-white/40 uppercase">Last hand</p>
      <ScoreLine play={state.last.play} />
    </div>
  )
}
