import { useState } from 'react'
import { motion } from 'motion/react'
import type { Outcome } from '../types'
import type { TicTacToeMove, TicTacToeState } from './rules'

const MARK_COLORS = ['text-lemon', 'text-mint'] as const

interface BoardProps {
  state: TicTacToeState
  outcome: Outcome | null
  /** Index of the local player, or -1 for spectators. */
  me: number
  canMove: boolean
  onMove(move: TicTacToeMove): void
}

export function TicTacToeBoard({ state, outcome, me, canMove, onMove }: BoardProps) {
  const [hover, setHover] = useState<number | null>(null)
  const line = outcome && 'winner' in outcome ? outcome.line : undefined

  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm">
      <div className="grid size-full grid-cols-3 grid-rows-3 gap-2.5 rounded-[2rem] bg-night-950/70 p-2.5 shadow-2xl ring-2 ring-white/10">
        {state.cells.map((cell, i) => {
          const playable = canMove && cell === null
          const highlighted = line?.includes(i)
          return (
            <motion.button
              key={i}
              aria-label={`Square ${i + 1}`}
              disabled={!playable}
              onClick={() => playable && onMove({ cell: i })}
              onHoverStart={() => setHover(i)}
              onHoverEnd={() => setHover((h) => (h === i ? null : h))}
              whileHover={playable ? { scale: 1.04 } : undefined}
              whileTap={playable ? { scale: 0.92 } : undefined}
              animate={highlighted ? { scale: [1, 1.1, 1] } : { scale: 1 }}
              transition={highlighted ? { duration: 0.6, delay: 0.5, repeat: 2 } : undefined}
              className={`relative min-h-0 min-w-0 rounded-2xl transition-colors ${
                highlighted ? 'bg-white/15' : 'bg-night-800/80'
              } ${playable ? 'cursor-pointer hover:bg-night-700' : 'cursor-default'}`}
            >
              {/* Absolutely positioned so marks can never change the cell's size. */}
              <span className="absolute inset-0 flex items-center justify-center">
                {cell !== null && <Mark player={cell} />}
                {cell === null && playable && hover === i && <Mark player={me} ghost />}
              </span>
            </motion.button>
          )
        })}
      </div>
      {line && <WinLine line={line} />}
    </div>
  )
}

export function Mark({ player, ghost, className = 'size-3/5' }: { player: number; ghost?: boolean; className?: string }) {
  const draw = ghost
    ? { initial: { pathLength: 1 }, animate: { pathLength: 1 } }
    : { initial: { pathLength: 0 }, animate: { pathLength: 1 } }
  return (
    <motion.svg
      viewBox="0 0 100 100"
      className={`${className} ${MARK_COLORS[player]} ${ghost ? 'opacity-25' : 'drop-shadow-[0_0_12px_currentColor]'}`}
      initial={ghost ? false : { scale: 0.4, rotate: -30 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 15 }}
      fill="none"
      stroke="currentColor"
      strokeWidth={14}
      strokeLinecap="round"
    >
      {player === 0 ? (
        <>
          <motion.path d="M22 22 L78 78" {...draw} transition={{ duration: 0.2 }} />
          <motion.path d="M78 22 L22 78" {...draw} transition={{ duration: 0.2, delay: 0.15 }} />
        </>
      ) : (
        <motion.circle cx="50" cy="50" r="30" {...draw} transition={{ duration: 0.35 }} />
      )}
    </motion.svg>
  )
}

function WinLine({ line }: { line: number[] }) {
  // Cell centers in a 0..300 box (each cell 100 wide).
  const center = (i: number) => ({ x: (i % 3) * 100 + 50, y: Math.floor(i / 3) * 100 + 50 })
  const a = center(line[0])
  const b = center(line[2])
  return (
    <svg viewBox="0 0 300 300" className="pointer-events-none absolute inset-2.5">
      <motion.line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="white"
        strokeWidth={10}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.9 }}
        transition={{ duration: 0.45, delay: 0.25, ease: 'easeOut' }}
        className="drop-shadow-[0_0_10px_white]"
      />
    </svg>
  )
}
