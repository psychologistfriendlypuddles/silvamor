import { useMemo } from 'react'
import { motion } from 'motion/react'
import type { BoardProps } from '../ui'
import { SIZE, counts, legalCells, type ReversiMove, type ReversiState } from './rules'

const DISC = [
  'bg-gradient-to-br from-[#5b5670] to-[#0d0a1a] shadow-[inset_-2px_-3px_5px_rgba(0,0,0,0.4)]',
  'bg-gradient-to-br from-white to-[#cfd3dc] shadow-[inset_-2px_-3px_5px_rgba(0,0,0,0.2)]',
] as const

export function ReversiBoard({ state, me, canMove, onMove }: BoardProps<ReversiState, ReversiMove>) {
  const legal = useMemo(() => new Set(canMove ? legalCells(state.cells, state.turn) : []), [canMove, state.cells, state.turn])
  const [dark, light] = counts(state.cells)
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-2">
      <div className="grid grid-cols-8 gap-[3px] rounded-[1.25rem] bg-[#0f4d39] p-2 shadow-2xl ring-2 ring-white/10">
        {state.cells.map((disc, i) => {
          const row = Math.floor(i / SIZE) + 1
          const col = (i % SIZE) + 1
          const flipped = state.flipped.includes(i)
          return (
            <button
              key={i}
              aria-label={`Cell ${row}-${col}`}
              disabled={!legal.has(i)}
              onClick={() => onMove({ cell: i })}
              className={`relative aspect-square rounded-md bg-[#1f7a5a] ${legal.has(i) ? 'cursor-pointer hover:bg-[#2a9470]' : 'cursor-default'}`}
            >
              {disc !== null && (
                <motion.span
                  // Flipped discs turn over; the new one pops in.
                  key={`${i}-${disc}`}
                  initial={i === state.last ? { scale: 0.3 } : flipped ? { rotateY: 90 } : false}
                  animate={{ scale: 1, rotateY: 0 }}
                  transition={{ duration: 0.35, delay: flipped ? 0.1 : 0 }}
                  className={`absolute inset-[9%] rounded-full ${DISC[disc]} ${i === state.last ? 'ring-2 ring-lemon' : ''}`}
                />
              )}
              {disc === null && legal.has(i) && <span className={`absolute inset-[38%] rounded-full opacity-40 ${DISC[me === 1 ? 1 : 0]}`} />}
            </button>
          )
        })}
      </div>
      <p className="text-center text-sm text-white/60">
        ⚫ {dark} · ⚪ {light}
        {state.passed !== null && (
          <span className="text-lemon">
            {' '}
            · {state.passed === me ? 'You had no move, so you passed.' : me < 0 ? 'A player had no move and passed.' : 'Your opponent had no move and passed.'}
          </span>
        )}
      </p>
    </div>
  )
}

export function ReversiBadge({ player }: { player: number }) {
  return <span className={`block size-8 rounded-full ${DISC[player === 1 ? 1 : 0]}`} />
}
