import { useState } from 'react'
import { motion } from 'motion/react'
import type { BoardProps } from '../ui'
import { MILLS, PIECES, POINTS, closesMill, onBoard, phase, removable, targets, type MorrisMove, type MorrisState } from './rules'

const COLORS = ['#fde047', '#5eead4'] as const
const STEP = 1
const PAD = 0.6
const pos = (p: number) => [PAD + POINTS[p][1] * STEP, PAD + POINTS[p][0] * STEP]

/**
 * Tap a point to place; tap one of your pieces, then where it goes, to move. When the
 * move closes a mill, tap the opponent piece to remove before it's sent.
 */
export function MorrisBoard({ state, me, canMove, onMove }: BoardProps<MorrisState, MorrisMove>) {
  const [from, setFrom] = useState<number | null>(null)
  const [pending, setPending] = useState<{ to: number; from?: number } | null>(null)
  const p = state.turn
  const ph = phase(state, p)
  const reachable = new Set(canMove && !pending ? targets(state, p, ph === 'place' ? undefined : (from ?? undefined)) : [])
  const removing = pending ? (() => {
    const board = [...state.board]
    if (pending.from !== undefined) board[pending.from] = null
    board[pending.to] = p
    return new Set(removable(board, (1 - p) as 0 | 1))
  })() : new Set<number>()

  const play = (to: number, fromPoint?: number) => {
    if (closesMill(state, p, to, fromPoint)) return setPending({ to, from: fromPoint })
    setFrom(null)
    onMove(fromPoint === undefined ? { to } : { from: fromPoint, to })
  }

  const tap = (pt: number) => {
    if (!canMove) return
    if (pending) {
      if (removing.has(pt)) {
        onMove({ ...pending, remove: pt })
        setPending(null)
        setFrom(null)
      }
      return
    }
    if (ph === 'place') return reachable.has(pt) && play(pt)
    if (state.board[pt] === p) return setFrom(targets(state, p, pt).length ? pt : null)
    if (from !== null && reachable.has(pt)) play(pt, from)
  }

  const view = 6 + PAD * 2
  const hand = (who: 0 | 1) => (
    <span className="flex items-center gap-1">
      {Array.from({ length: state.inHand[who] }, (_, i) => (
        <span key={i} className="size-2.5 rounded-full" style={{ background: COLORS[who] }} />
      ))}
      {!state.inHand[who] && <span className="text-xs text-white/45">{onBoard(state, who)} on board</span>}
    </span>
  )
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-2">
      <div className="flex justify-between px-1 text-xs text-white/55">{hand(0)}{hand(1)}</div>
      <svg viewBox={`0 0 ${view} ${view}`} className="w-full touch-manipulation rounded-[1.25rem] bg-grape/30 shadow-2xl ring-2 ring-white/10">
        {MILLS.map((m, i) => {
          const [x1, y1] = pos(m[0])
          const [x2, y2] = pos(m[2])
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth={0.06} strokeLinecap="round" />
        })}
        {POINTS.map((_, pt) => {
          const [x, y] = pos(pt)
          const piece = state.board[pt]
          const isLast = state.last?.to === pt
          return (
            <g key={pt}>
              <circle cx={x} cy={y} r={0.12} fill="rgba(255,255,255,0.55)" />
              {piece !== null && (
                <motion.circle
                  cx={x}
                  cy={y}
                  r={0.3}
                  fill={COLORS[piece]}
                  stroke={from === pt ? '#fff' : removing.has(pt) ? '#f43f5e' : isLast ? '#ffffff' : 'rgba(0,0,0,0.35)'}
                  strokeWidth={from === pt || removing.has(pt) ? 0.08 : 0.04}
                  initial={isLast ? { scale: 0.4 } : false}
                  animate={removing.has(pt) ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={removing.has(pt) ? { duration: 0.9, repeat: Infinity } : { type: 'spring', stiffness: 500, damping: 22 }}
                  style={{ transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}
                />
              )}
              {pending?.to === pt && <circle cx={x} cy={y} r={0.3} fill={COLORS[p]} opacity={0.8} />}
              {reachable.has(pt) && piece === null && <circle cx={x} cy={y} r={0.16} fill={COLORS[me === 1 ? 1 : 0]} opacity={0.6} />}
              <rect
                x={x - 0.45}
                y={y - 0.45}
                width={0.9}
                height={0.9}
                fill="transparent"
                role="button"
                aria-label={`Point ${pt + 1}`}
                className={canMove ? 'cursor-pointer' : ''}
                onClick={() => tap(pt)}
              />
            </g>
          )
        })}
      </svg>
      {canMove && (
        <p className="text-center text-sm text-white/60">
          {pending ? (
            <span className="font-semibold text-bubblegum">Mill! Tap one of your opponent’s pieces to remove it.</span>
          ) : ph === 'place' ? (
            `Place a piece (${state.inHand[p]} of ${PIECES} left).`
          ) : ph === 'fly' ? (
            'Down to three: your pieces can fly to any empty point.'
          ) : (
            'Tap one of your pieces, then a neighbouring empty point.'
          )}
        </p>
      )}
    </div>
  )
}

export function MorrisBadge({ player }: { player: number }) {
  return <span className="block size-8 rounded-full shadow-[inset_0_-3px_0_rgba(0,0,0,0.25)]" style={{ background: COLORS[player === 1 ? 1 : 0] }} />
}
