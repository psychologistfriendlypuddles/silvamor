import { useState } from 'react'
import { motion } from 'motion/react'

export type Stone = 0 | 1 | null

/** Black for player 0, white for player 1, with a little shine. */
const STONE_FILL = ['url(#stone-black)', 'url(#stone-white)'] as const

export function StoneBadge({ player }: { player: number }) {
  return (
    <span
      className={`block size-8 rounded-full shadow-[inset_-3px_-4px_6px_rgba(0,0,0,0.35)] ${
        player === 0 ? 'bg-gradient-to-br from-[#5b5670] to-[#0d0a1a]' : 'bg-gradient-to-br from-white to-[#cfd3dc]'
      }`}
    />
  )
}

/** Hoshi (star points) for the usual board sizes. */
function starPoints(size: number): number[] {
  const edge = size >= 13 ? 3 : 2
  const far = size - 1 - edge
  const mid = (size - 1) / 2
  const pts = [
    [edge, edge],
    [edge, far],
    [far, edge],
    [far, far],
  ]
  if (size % 2 === 1) pts.push([mid, mid])
  if (size >= 19) pts.push([edge, mid], [mid, edge], [far, mid], [mid, far])
  return pts.map(([r, c]) => r * size + c)
}

/**
 * A board where stones go on the intersections (Go, Gomoku). With a mouse a click places a
 * stone; on touch screens the first tap shows where it would go and a second tap places it,
 * since the points are small on a phone.
 */
export function IntersectionBoard({
  size,
  stones,
  last,
  line,
  territory,
  me,
  canMove,
  legal,
  onPlay,
}: {
  size: number
  stones: Stone[]
  last: number | null
  /** Highlighted stones (a winning line). */
  line?: number[]
  /** Shaded points at the end of a Go game: whose area each empty point is. */
  territory?: Stone[]
  me: number
  canMove: boolean
  legal?(point: number): boolean
  onPlay(point: number): void
}) {
  const [pending, setPending] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const pad = 0.8
  const view = size - 1 + pad * 2
  const xy = (p: number) => [pad + (p % size), pad + Math.floor(p / size)]
  const can = (p: number) => canMove && stones[p] === null && (legal?.(p) ?? true)
  const ghost = canMove ? (pending ?? hover) : null
  const stars = starPoints(size)

  const tap = (p: number, touch: boolean) => {
    if (!can(p)) return setPending(null)
    if (touch && pending !== p) return setPending(p)
    setPending(null)
    onPlay(p)
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <svg viewBox={`0 0 ${view} ${view}`} className="w-full touch-manipulation rounded-[1.25rem] bg-[#e3b878] shadow-2xl ring-2 ring-white/10" onMouseLeave={() => setHover(null)}>
        <defs>
          <radialGradient id="stone-black" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#6a6585" />
            <stop offset="100%" stopColor="#0d0a1a" />
          </radialGradient>
          <radialGradient id="stone-white" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#c8ccd6" />
          </radialGradient>
        </defs>
        {Array.from({ length: size }, (_, i) => (
          <g key={i} stroke="#5a3b17" strokeWidth={0.045}>
            <line x1={pad} y1={pad + i} x2={pad + size - 1} y2={pad + i} />
            <line x1={pad + i} y1={pad} x2={pad + i} y2={pad + size - 1} />
          </g>
        ))}
        {stars.map((p) => {
          const [x, y] = xy(p)
          return <circle key={p} cx={x} cy={y} r={0.11} fill="#5a3b17" />
        })}
        {territory?.map((t, p) => {
          if (t === null || stones[p] !== null) return null
          const [x, y] = xy(p)
          return <rect key={`t${p}`} x={x - 0.17} y={y - 0.17} width={0.34} height={0.34} fill={STONE_FILL[t]} opacity={0.85} />
        })}
        {stones.map((s, p) => {
          if (s === null) return null
          const [x, y] = xy(p)
          const winning = line?.includes(p)
          return (
            <g key={p}>
              <motion.circle
                cx={x}
                cy={y}
                r={0.46}
                fill={STONE_FILL[s]}
                stroke={s === 1 ? '#9aa0ae' : 'none'}
                strokeWidth={0.03}
                initial={p === last ? { scale: 0.4, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                style={{ transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}
              />
              {p === last && <circle cx={x} cy={y} r={0.16} fill="none" stroke={s === 0 ? '#fde047' : '#8b5cf6'} strokeWidth={0.07} />}
              {winning && <circle cx={x} cy={y} r={0.5} fill="none" stroke="#5eead4" strokeWidth={0.09} />}
            </g>
          )
        })}
        {ghost !== null && can(ghost) && (
          <circle cx={xy(ghost)[0]} cy={xy(ghost)[1]} r={0.44} fill={STONE_FILL[me === 1 ? 1 : 0]} opacity={pending === ghost ? 0.75 : 0.4} />
        )}
        {pending !== null && <circle cx={xy(pending)[0]} cy={xy(pending)[1]} r={0.56} fill="none" stroke="#fde047" strokeWidth={0.08} strokeDasharray="0.2 0.12" />}
        {/* Hit areas: a square around every point. */}
        {stones.map((_, p) => {
          const [x, y] = xy(p)
          const row = Math.floor(p / size) + 1
          const col = (p % size) + 1
          return (
            <rect
              key={`h${p}`}
              x={x - 0.5}
              y={y - 0.5}
              width={1}
              height={1}
              fill="transparent"
              role="button"
              aria-label={`Point ${row}-${col}`}
              aria-disabled={!can(p)}
              className={can(p) ? 'cursor-pointer' : ''}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(p)}
              onPointerUp={(e) => tap(p, e.pointerType !== 'mouse')}
            />
          )
        })}
      </svg>
      {pending !== null && <p className="mt-2 text-center text-sm text-white/55">Tap the same point again to place your stone.</p>}
    </div>
  )
}
