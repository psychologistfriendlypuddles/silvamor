import { useState } from 'react'
import { motion } from 'motion/react'
import type { BoardProps } from '../ui'
import { COLS, ROWS, landingCell, type FourInARowMove, type FourInARowState } from './rules'

const DISC_COLORS = ['bg-lemon shadow-[inset_0_-4px_0_rgba(0,0,0,0.18)]', 'bg-mint shadow-[inset_0_-4px_0_rgba(0,0,0,0.18)]'] as const

export function FourInARowBoard({ state, outcome, me, canMove, onMove }: BoardProps<FourInARowState, FourInARowMove>) {
  const [hoverCol, setHoverCol] = useState<number | null>(null)
  const line = outcome && 'winner' in outcome ? outcome.line : undefined
  const ghost = canMove && hoverCol !== null ? landingCell(state.cells, hoverCol) : -1

  return (
    <div className="mx-auto w-full max-w-md">
      <div
        className="grid gap-1.5 rounded-[1.75rem] bg-grape/35 p-2.5 shadow-2xl ring-2 ring-white/10"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
        onMouseLeave={() => setHoverCol(null)}
      >
        {Array.from({ length: COLS }, (_, col) => {
          const playable = canMove && landingCell(state.cells, col) >= 0
          return (
            <button
              key={col}
              aria-label={`Column ${col + 1}`}
              disabled={!playable}
              onClick={() => playable && onMove({ col })}
              onMouseEnter={() => setHoverCol(col)}
              className={`flex flex-col gap-1.5 rounded-2xl p-0.5 transition-colors ${playable ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'}`}
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const i = row * COLS + col
                const disc = state.cells[i]
                const winning = line?.includes(i)
                return (
                  <span key={row} className="relative aspect-square w-full rounded-full bg-night-950/80 shadow-[inset_0_3px_6px_rgba(0,0,0,0.5)]">
                    {disc !== null && (
                      <motion.span
                        className={`absolute inset-0 rounded-full ${DISC_COLORS[disc]} ${winning ? 'ring-4 ring-white' : ''}`}
                        // The newest disc drops in from above its column.
                        initial={i === state.last ? { y: `${-(row + 1) * 115}%` } : false}
                        animate={winning ? { y: 0, scale: [1, 1.12, 1] } : { y: 0 }}
                        transition={
                          winning ? { scale: { duration: 0.6, delay: 0.4, repeat: 2 } } : { type: 'spring', stiffness: 260, damping: 18 }
                        }
                      />
                    )}
                    {disc === null && i === ghost && <span className={`absolute inset-0 rounded-full opacity-30 ${DISC_COLORS[me as 0 | 1]}`} />}
                  </span>
                )
              })}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function FourInARowBadge({ player }: { player: number }) {
  return <span className={`block size-8 rounded-full ${DISC_COLORS[player as 0 | 1]}`} />
}
