import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { BoardProps } from '../ui'
import { geometry, scores, sizeOf, type DotsAndBoxesMove, type DotsAndBoxesState } from './rules'

const GAP = 100
const MARGIN = 30
const STROKES = ['stroke-lemon', 'stroke-mint'] as const
const FILLS = ['fill-lemon/35', 'fill-mint/35'] as const
const TEXT = ['fill-lemon', 'fill-mint'] as const

const at = (n: number) => MARGIN + n * GAP
/** Half-width of a line's tap area, short of the dots so neighbouring lines don't overlap much. */
const HIT = 18

/** Endpoints of an edge on an N×N board, in SVG coordinates. */
function edgeLine(size: number, hEdges: number, edge: number) {
  if (edge < hEdges) {
    const r = Math.floor(edge / size)
    const c = edge % size
    return { x1: at(c), y1: at(r), x2: at(c + 1), y2: at(r) }
  }
  const r = Math.floor((edge - hEdges) / (size + 1))
  const c = (edge - hEdges) % (size + 1)
  return { x1: at(c), y1: at(r), x2: at(c), y2: at(r + 1) }
}

/** Taps in a row that miss every open line before suggesting pinch-to-zoom. */
const MISSES_BEFORE_TIP = 3
/** From this board size, touch players confirm each line through a magnifier (lines get small). */
const CONFIRM_FROM_SIZE = 12
/** Magnifier: on-screen diameter (px) and how much of the board it shows (board units, ~2.5 boxes). */
const BUBBLE_PX = 150
const BUBBLE_SPAN = GAP * 2.5

export function DotsAndBoxesBoard({ state, outcome, me, canMove, onMove }: BoardProps<DotsAndBoxesState, DotsAndBoxesMove>) {
  const [hover, setHover] = useState<number | null>(null)
  const winner = outcome && 'winner' in outcome ? outcome.winner : null
  const SIZE = sizeOf(state)
  const { hEdges, edges: EDGES, boxesOf } = useMemo(() => geometry(SIZE), [SIZE])
  const VIEW = SIZE * GAP + 2 * MARGIN
  // Big boards are scaled down a lot on screen: thicken lines so they stay tappable and
  // visible, but grow dots less so they don't crowd the lines.
  const strokeWidth = Math.max(10, SIZE * 1.8)
  const dotRadius = Math.max(9, SIZE * 0.8)

  // Touch players who keep missing the lines get a one-time pinch-to-zoom tip.
  const pointerType = useRef('mouse')
  const misses = useRef(0)
  const [tip, setTip] = useState<'hidden' | 'shown' | 'done'>('hidden')
  useEffect(() => {
    if (tip !== 'shown') return
    const t = setTimeout(() => setTip('done'), 6000)
    return () => clearTimeout(t)
  }, [tip])
  // Touch on big boards: the first tap selects a line and opens a magnifier at that spot;
  // tapping the magnifier (or the same line again) draws it.
  const wrapper = useRef<HTMLDivElement>(null)
  const lastTap = useRef({ x: 0, y: 0 })
  /** The selected line, where it was tapped (px within the board) and the board's width then. */
  const [selected, setSelected] = useState<{ edge: number; x: number; y: number; width: number } | null>(null)
  const confirming = selected && canMove && state.edges[selected.edge] === null ? selected : null

  const onBoardTap = (e: MouseEvent<SVGSVGElement>) => {
    const hitLine = (e.target as Element).closest('[role="button"]')
    if (!hitLine) setSelected(null) // tapping empty space cancels a selection
    if (pointerType.current !== 'touch' || !canMove || tip !== 'hidden') return
    misses.current = hitLine ? 0 : misses.current + 1
    if (misses.current >= MISSES_BEFORE_TIP) setTip('shown')
  }

  const tapLine = useCallback(
    (edge: number) => {
      if (!canMove) return
      if (pointerType.current !== 'touch' || SIZE < CONFIRM_FROM_SIZE) return onMove({ edge })
      if (selected?.edge === edge) {
        setSelected(null)
        return onMove({ edge })
      }
      setSelected({ edge, ...lastTap.current, width: wrapper.current?.clientWidth ?? 0 })
    },
    [canMove, SIZE, selected, onMove],
  )

  // Everything but the hover preview, so moving the mouse doesn't redraw hundreds of lines.
  const board = useMemo(() => {
    const fresh = state.last === null ? [] : boxesOf(state.last) // boxes the last line just completed
    return (
      <>
        {/* Completed boxes; only fresh ones animate */}
        {state.boxes.map((owner, b) => {
          if (owner === null) return null
          const r = Math.floor(b / SIZE)
          const c = b % SIZE
          const content = (
            <>
              <rect x={at(c) + 6} y={at(r) + 6} width={GAP - 12} height={GAP - 12} rx={14} className={`${FILLS[owner]} ${winner === owner ? 'animate-pulse' : ''}`} />
              <text x={at(c) + GAP / 2} y={at(r) + GAP / 2 + 13} textAnchor="middle" className={`${TEXT[owner]} text-[38px] font-bold`}>
                {owner === me ? '★' : '●'}
              </text>
            </>
          )
          return fresh.includes(b) ? (
            <motion.g key={`box-${b}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ transformOrigin: `${at(c) + GAP / 2}px ${at(r) + GAP / 2}px` }}>
              {content}
            </motion.g>
          ) : (
            <g key={`box-${b}`}>{content}</g>
          )
        })}

        {/* Lines: drawn ones in their player's color (only the newest animates), open ones tappable */}
        {Array.from({ length: EDGES }, (_, edge) => {
          const owner = state.edges[edge]
          const line = edgeLine(SIZE, hEdges, edge)
          if (owner !== null) {
            return edge === state.last ? (
              <motion.line
                key={edge}
                {...line}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                className={`${STROKES[owner]} drop-shadow-[0_0_8px_currentColor]`}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.25 }}
              />
            ) : (
              <line key={edge} {...line} strokeWidth={strokeWidth} strokeLinecap="round" className={STROKES[owner]} />
            )
          }
          return (
            <g
              key={edge}
              role="button"
              aria-label={`Line ${edge + 1}`}
              aria-disabled={!canMove}
              onClick={() => tapLine(edge)}
              onMouseEnter={() => setHover(edge)}
              className={canMove ? 'cursor-pointer' : ''}
            >
              <line {...line} strokeWidth={strokeWidth} strokeLinecap="round" className="stroke-white/10" />
              {/* Generous invisible tap area. A rect (not a thick line) so it has a real size. */}
              <rect
                x={Math.min(line.x1, line.x2) - HIT}
                y={Math.min(line.y1, line.y2) - HIT}
                width={Math.abs(line.x2 - line.x1) + 2 * HIT}
                height={Math.abs(line.y2 - line.y1) + 2 * HIT}
                fill="transparent"
              />
            </g>
          )
        })}

        {/* Dots on top */}
        {Array.from({ length: (SIZE + 1) ** 2 }, (_, i) => (
          <circle key={i} cx={at(i % (SIZE + 1))} cy={at(Math.floor(i / (SIZE + 1)))} r={dotRadius} className="pointer-events-none fill-white" />
        ))}
      </>
    )
  }, [state, SIZE, EDGES, hEdges, boxesOf, winner, me, canMove, tapLine, strokeWidth, dotRadius])

  const preview = canMove && hover !== null && state.edges[hover] === null ? edgeLine(SIZE, hEdges, hover) : null
  const chosen = confirming ? edgeLine(SIZE, hEdges, confirming.edge) : null

  // Place the magnifier just above the finger (below it near the top), inside the board.
  const bubble = (() => {
    if (!confirming || !chosen) return null
    const width = confirming.width
    const left = Math.min(Math.max(confirming.x - BUBBLE_PX / 2, 4), width - BUBBLE_PX - 4)
    // Prefer above the finger (which hides what's below it), nudged down to fit if need be;
    // only near the very top does it go below.
    const top = confirming.y > BUBBLE_PX * 0.75 ? Math.max(4, confirming.y - BUBBLE_PX - 28) : confirming.y + 28
    const cx = (chosen.x1 + chosen.x2) / 2
    const cy = (chosen.y1 + chosen.y2) / 2
    return { left, top, viewBox: `${cx - BUBBLE_SPAN / 2} ${cy - BUBBLE_SPAN / 2} ${BUBBLE_SPAN} ${BUBBLE_SPAN}` }
  })()

  return (
    <div
      ref={wrapper}
      className={`relative mx-auto w-full rounded-[1.75rem] bg-night-950/70 p-2 shadow-2xl ring-2 ring-white/10 ${SIZE > 4 ? 'max-w-2xl' : 'max-w-md'}`}
    >
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="block w-full"
        onMouseLeave={() => setHover(null)}
        onPointerDown={(e) => {
          pointerType.current = e.pointerType
          const box = wrapper.current?.getBoundingClientRect()
          if (box) lastTap.current = { x: e.clientX - box.left, y: e.clientY - box.top }
        }}
        onClick={onBoardTap}
      >
        {board}
        {preview && <line {...preview} strokeWidth={strokeWidth} strokeLinecap="round" className={`pointer-events-none ${STROKES[me as 0 | 1]} opacity-50`} />}
        {chosen && (
          <line {...chosen} strokeWidth={strokeWidth} strokeLinecap="round" className={`pointer-events-none ${STROKES[me as 0 | 1]} animate-pulse drop-shadow-[0_0_8px_currentColor]`} />
        )}
      </svg>

      {/* The magnifier: an enlarged view of the board around the chosen line. Tap it to draw the line. */}
      <AnimatePresence>
        {confirming && bubble && chosen && (
          <motion.div
            key="magnifier"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="absolute z-20 flex flex-col items-center"
            style={{ left: bubble.left, top: bubble.top, width: BUBBLE_PX }}
          >
            <button
              aria-label={`Confirm line ${confirming.edge + 1}`}
              onClick={() => {
                setSelected(null)
                onMove({ edge: confirming.edge })
              }}
              className="block overflow-hidden rounded-full bg-night-950 shadow-2xl ring-4 ring-white/80"
              style={{ width: BUBBLE_PX, height: BUBBLE_PX }}
            >
              <svg viewBox={bubble.viewBox} className="pointer-events-none block size-full" aria-hidden>
                {board}
                <line {...chosen} strokeWidth={strokeWidth} strokeLinecap="round" className={`${STROKES[me as 0 | 1]} drop-shadow-[0_0_8px_currentColor]`} />
              </svg>
            </button>
            {/* An explicit way out: on dense boards a tap on "empty space" usually snaps onto a line. */}
            <span className="mt-1 flex items-center gap-1">
              <span className="rounded-full bg-night-900/90 px-2 py-0.5 text-xs font-semibold text-white">tap to confirm</span>
              <button
                aria-label="Cancel"
                onClick={() => setSelected(null)}
                className="rounded-full bg-night-900/90 px-2 py-0.5 text-xs font-semibold text-white/70 hover:text-white"
              >
                ✕
              </button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tip === 'shown' && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-x-4 top-4 z-10 flex items-center gap-3 rounded-2xl border border-lemon/40 bg-night-900/95 p-3 text-sm shadow-2xl backdrop-blur"
          >
            <span className="text-2xl">🤏</span>
            <span className="flex-1">
              <span className="block font-semibold">Tricky to hit a line?</span>
              <span className="text-white/60">Pinch with two fingers to zoom in on the board.</span>
            </span>
            <button onClick={() => setTip('done')} className="rounded-lg px-2 py-1 text-white/50 hover:text-white" aria-label="Dismiss tip">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Player badge: their color with their current number of boxes. */
export function DotsAndBoxesBadge({ player, state }: { player: number; state: DotsAndBoxesState }) {
  return (
    <span
      className={`flex size-8 items-center justify-center rounded-lg text-sm font-bold text-night-950 ${player === 0 ? 'bg-lemon' : 'bg-mint'}`}
      title={`${scores(state)[player]} boxes`}
    >
      {scores(state)[player]}
    </span>
  )
}
