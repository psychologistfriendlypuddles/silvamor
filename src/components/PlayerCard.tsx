import { motion } from 'motion/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { useDisplayName } from '../hooks/useDisplayName'
import { Avatar } from './Avatar'
import { RecordLine, VerifiedBadge } from './Record'
import { SpriteView, type SpriteCue } from './Sprite'
import { usePlayerSprite } from '../stores/sprites'
import { FEATURES } from '../features'
import type { SpriteMood } from '../lib/sprites'

export type Mood = SpriteMood

const wide = () => matchMedia('(min-width: 768px)').matches
const onResize = (cb: () => void) => {
  const mq = matchMedia('(min-width: 768px)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** A player's corner of the board: their sprite reacting to the game, name and strikes. */
export function PlayerCard({
  pubkey,
  mark,
  active,
  mood,
  cue = null,
  label,
  align = 'left',
  strikes = null,
  onOpen,
}: {
  pubkey: string
  mark: ReactNode
  active: boolean
  mood: Mood
  /** A one-shot reaction (strike, capture, check, chat). */
  cue?: SpriteCue | null
  label?: string
  align?: 'left' | 'right'
  /** Strikes so far (0-3), or null when the game has no turn clock. */
  strikes?: number | null
  /** Opens the player's profile. */
  onOpen?(): void
}) {
  const name = useDisplayName(pubkey)
  const sprite = usePlayerSprite(pubkey)
  const isWide = useSyncExternalStore(onResize, wide)

  return (
    <motion.div
      animate={active ? { scale: 1.03 } : { scale: 1 }}
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      aria-label={onOpen ? `${name}'s profile` : undefined}
      className={`relative flex min-w-0 flex-1 items-center gap-3 rounded-3xl border-2 p-3 transition-colors ${onOpen ? 'cursor-pointer' : ''} ${
        active ? 'border-grape bg-grape/15 shadow-lg shadow-grape/30' : 'border-white/10 bg-night-900/70'
      } ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      <div className="relative">
        {/* Sprites face right; the right-hand player's turns to face the board. */}
        <SpriteView sprite={sprite} mood={mood} cue={cue} size={isWide ? 88 : 64} mirror={align === 'right'} />
        <span className={`absolute -bottom-1 ${align === 'right' ? '-left-1' : '-right-1'} flex`}>
          <Avatar pubkey={pubkey} className="size-6 text-[10px] md:size-7" />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1 font-semibold ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          <span className="truncate">{name}</span>
          <VerifiedBadge pubkey={pubkey} />
        </p>
        <p className="truncate text-xs text-white/50">{label}</p>
        {strikes != null && (
          <p className={`flex text-xs ${align === 'right' ? 'justify-end' : ''}`}>
            <StrikeLights strikes={strikes} />
          </p>
        )}
        {FEATURES.ratings && (
          <p className="truncate text-[11px]">
            <RecordLine pubkey={pubkey} />
          </p>
        )}
      </div>
      <div className="size-8 shrink-0">{mark}</div>
    </motion.div>
  )
}

/** Three slots that light up ⚡ as strikes land. */
function StrikeLights({ strikes }: { strikes: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${strikes} of 3 strikes`} title={`${strikes} of 3 strikes`}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={i < strikes ? { scale: [1.6, 1], opacity: 1 } : { opacity: 0.25 }}
          className={i < strikes ? 'text-tangerine' : 'text-white'}
        >
          {i < strikes ? '⚡' : '·'}
        </motion.span>
      ))}
    </span>
  )
}
