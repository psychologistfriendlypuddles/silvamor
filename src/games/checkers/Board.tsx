import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import type { BoardProps } from '../ui'
import { SIZE, isKing, legalMoves, ownerOf, type CheckersMove, type CheckersState } from './rules'

const PIECE = [
  'bg-gradient-to-br from-[#ff8a8a] to-[#d4344a] shadow-[inset_0_-4px_0_rgba(0,0,0,0.25)]',
  'bg-gradient-to-br from-[#fffaf0] to-[#d9cdb4] shadow-[inset_0_-4px_0_rgba(0,0,0,0.18)]',
] as const

/**
 * Tap a piece, then where it lands. A multi-jump is tapped one landing at a time
 * (squares that only continue a jump are marked until the move is complete).
 */
export function CheckersBoard({ state, me, canMove, onMove }: BoardProps<CheckersState, CheckersMove>) {
  const [path, setPath] = useState<number[]>([])
  const moves = useMemo(() => (canMove ? legalMoves(state.board, state.turn) : []), [canMove, state.board, state.turn])
  const flipped = me === 1 // the second player sees their pieces at the bottom
  const starts = new Set(moves.map((m) => m.path[0]))
  const continuing = moves.filter((m) => path.length > 0 && path.every((sq, i) => m.path[i] === sq))
  const nextSquares = new Set(continuing.map((m) => m.path[path.length]).filter((sq) => sq !== undefined))
  const mustCapture = moves.some((m) => m.captured.length)

  const tap = (sq: number) => {
    if (!canMove) return
    if (nextSquares.has(sq)) {
      const next = [...path, sq]
      const done = continuing.filter((m) => m.path.length === next.length && next.every((s, i) => m.path[i] === s))
      const longer = continuing.some((m) => m.path.length > next.length && next.every((s, i) => m.path[i] === s))
      if (done.length && !longer) {
        setPath([])
        onMove({ path: next })
      } else setPath(next)
      return
    }
    setPath(starts.has(sq) ? [sq] : [])
  }

  const order = Array.from({ length: SIZE * SIZE }, (_, i) => (flipped ? SIZE * SIZE - 1 - i : i))
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-2">
      <div className="grid grid-cols-8 overflow-hidden rounded-[1.25rem] shadow-2xl ring-2 ring-white/10">
        {order.map((sq) => {
          const dark = (Math.floor(sq / SIZE) + (sq % SIZE)) % 2 === 1
          const piece = state.board[sq]
          const owner = ownerOf(piece)
          const selected = path.includes(sq)
          const target = nextSquares.has(sq)
          const wasLast = state.last.includes(sq)
          return (
            <button
              key={sq}
              aria-label={`Square ${Math.floor(sq / SIZE) + 1}-${(sq % SIZE) + 1}`}
              disabled={!dark || !canMove}
              onClick={() => tap(sq)}
              className={`relative aspect-square ${dark ? (wasLast ? 'bg-[#7a5a3a]' : 'bg-[#5b3d26]') : 'bg-[#f1dfc0]'} ${
                target ? 'cursor-pointer' : starts.has(sq) ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              {owner !== null && (
                <motion.span
                  className={`absolute inset-[12%] flex items-center justify-center rounded-full ${PIECE[owner]} ${selected ? 'ring-4 ring-lemon' : ''} ${
                    canMove && starts.has(sq) && !path.length && mustCapture ? 'ring-2 ring-bubblegum' : ''
                  }`}
                  initial={state.last[state.last.length - 1] === sq ? { scale: 0.8 } : false}
                  animate={{ scale: 1 }}
                >
                  {isKing(piece) && <span className="text-[0.9em] leading-none">👑</span>}
                </motion.span>
              )}
              {target && <span className="absolute inset-[36%] rounded-full bg-lemon/70" />}
            </button>
          )
        })}
      </div>
      {canMove && mustCapture && <p className="text-center text-sm text-bubblegum">You must capture.</p>}
    </div>
  )
}

export function CheckersBadge({ player }: { player: number }) {
  return <span className={`block size-8 rounded-full ${PIECE[player === 1 ? 1 : 0]}`} />
}
