import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Chess, type Square } from 'chess.js'
import type { BoardProps } from '../ui'
import type { ChessMove, ChessState, Promotion } from './rules'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
// Solid shapes (U+265A..F) and outline shapes (U+2654..9) of the same pieces.
const SOLID: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const OUTLINE: Record<string, string> = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }
const NAMES: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }

/**
 * A chess piece in the bundled chess font, drawn as two layers of the same
 * piece: the solid shape and the outline shape on top. White: white body with
 * dark lines. Black: both layers dark, so the outline fills the solid shape's
 * cut-out details (which would otherwise show the square through) and the piece
 * reads as a dark silhouette, with a soft light edge for contrast on dark squares.
 */
export function Piece({ type, color, className = '' }: { type: string; color: 'w' | 'b'; className?: string }) {
  const [body, lines] = color === 'w' ? ['text-white', 'text-night-950'] : ['text-night-950', 'text-night-950']
  const shadow = color === 'w' ? 'drop-shadow-[0_2px_2px_rgba(0,0,0,0.4)]' : 'drop-shadow-[0_0_1px_rgba(255,255,255,0.8)] drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]'
  return (
    <span className={`inline-grid font-chess leading-none select-none ${shadow} ${className}`}>
      {/* A stroke in the body's own color closes the solid shape's small cut-outs. */}
      <span className={`col-start-1 row-start-1 [-webkit-text-stroke:2.5px_currentColor] ${body}`}>{SOLID[type]}</span>
      <span className={`col-start-1 row-start-1 ${lines}`}>{OUTLINE[type]}</span>
    </span>
  )
}

export function ChessBoard({ state, outcome, me, canMove, onMove }: BoardProps<ChessState, ChessMove>) {
  const game = useMemo(() => new Chess(state.fen), [state.fen])
  const [selected, setSelected] = useState<Square | null>(null)
  const [promoting, setPromoting] = useState<{ from: Square; to: Square } | null>(null)
  const myColor = me === 1 ? 'b' : 'w'
  const flipped = me === 1 // Black sees their pieces at the bottom.
  const board = game.board()

  const targets = useMemo(() => {
    if (!selected || !canMove) return new Map<string, { capture: boolean; promotion: boolean }>()
    const moves = game.moves({ square: selected, verbose: true })
    return new Map(moves.map((m) => [m.to, { capture: !!m.captured, promotion: !!m.promotion }]))
  }, [game, selected, canMove])

  // King in check (the side to move), for a red glow.
  const checkSquare = useMemo(() => {
    if (!game.inCheck()) return null
    const turn = game.turn()
    for (const row of board) for (const sq of row) if (sq && sq.type === 'k' && sq.color === turn) return sq.square
    return null
  }, [game, board])

  const tap = (square: Square) => {
    if (!canMove || outcome) return
    const target = targets.get(square)
    if (selected && target) {
      setSelected(null)
      if (target.promotion) setPromoting({ from: selected, to: square })
      else onMove({ from: selected, to: square })
      return
    }
    const piece = game.get(square)
    setSelected(piece && piece.color === myColor && square !== selected ? square : null)
  }

  const rows = flipped ? [...board].reverse().map((r) => [...r].reverse()) : board
  const winnerSide = outcome && 'winner' in outcome ? (outcome.winner === 0 ? 'w' : 'b') : null

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="grid grid-cols-8 overflow-hidden rounded-2xl shadow-2xl ring-4 ring-night-800">
        {rows.flatMap((row, r) =>
          row.map((piece, c) => {
            const file = FILES[flipped ? 7 - c : c]
            const rank = flipped ? r + 1 : 8 - r
            const square = `${file}${rank}` as Square
            const light = (FILES.indexOf(file) + rank) % 2 === 0 // a1 is dark, h1 light
            const target = targets.get(square)
            const isLast = state.last && (state.last.from === square || state.last.to === square)
            const movedHere = state.last?.to === square
            // Slide the moved piece in from where it came from (in board squares, as the viewer sees them).
            const from = movedHere && state.last ? state.last.from : null
            const dx = from ? (FILES.indexOf(from[0]) - FILES.indexOf(file)) * (flipped ? -1 : 1) : 0
            const dy = from ? (Number(from[1]) - rank) * (flipped ? 1 : -1) : 0
            return (
              <button
                key={square}
                aria-label={piece ? `${square} ${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : square}
                onClick={() => tap(square)}
                className={`relative flex aspect-square items-center justify-center ${light ? 'bg-[#e3d6ff]' : 'bg-[#9b7fe0]'} ${
                  canMove ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                {isLast && <span className="absolute inset-0 bg-lemon/40" />}
                {selected === square && <span className="absolute inset-0 bg-mint/60" />}
                {checkSquare === square && <span className="absolute inset-0 bg-[radial-gradient(circle,rgba(244,63,94,0.9)_0%,rgba(244,63,94,0)_75%)]" />}
                {piece && (
                  <motion.span
                    key={`${state.fen}-${square}`}
                    initial={movedHere ? { x: `${dx * 100}%`, y: `${dy * 100}%` } : false}
                    animate={{ x: 0, y: 0, scale: winnerSide && piece.type === 'k' && piece.color === winnerSide ? [1, 1.25, 1] : 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30, scale: { duration: 0.6, repeat: 2 } }}
                    className="relative z-10 flex size-full items-center justify-center"
                  >
                    <Piece type={piece.type} color={piece.color} className="text-[2.15rem] sm:text-[2.6rem]" />
                  </motion.span>
                )}
                {target && !target.capture && <span className="absolute z-20 size-[28%] rounded-full bg-night-950/35" />}
                {target?.capture && <span className="absolute inset-[6%] z-20 rounded-full border-[5px] border-night-950/35" />}
                {/* Coordinates along the bottom and left edges */}
                {r === 7 && <span className={`absolute right-0.5 bottom-0 text-[9px] font-bold ${light ? 'text-[#7c5cc8]' : 'text-[#efe7ff]'}`}>{file}</span>}
                {c === 0 && <span className={`absolute top-0 left-0.5 text-[9px] font-bold ${light ? 'text-[#7c5cc8]' : 'text-[#efe7ff]'}`}>{rank}</span>}
              </button>
            )
          }),
        )}
      </div>

      <AnimatePresence>
        {promoting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-night-950/70 backdrop-blur-sm"
          >
            <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="rounded-2xl bg-night-900 p-4 text-center shadow-2xl ring-2 ring-white/10">
              <p className="mb-3 font-display text-lg">promote to…</p>
              <div className="flex gap-2">
                {(['q', 'r', 'b', 'n'] as Promotion[]).map((p) => (
                  <button
                    key={p}
                    aria-label={`Promote to ${NAMES[p]}`}
                    onClick={() => {
                      onMove({ ...promoting, promotion: p })
                      setPromoting(null)
                    }}
                    className="flex size-14 items-center justify-center rounded-xl bg-[#e3d6ff] hover:bg-mint"
                  >
                    <Piece type={p} color={myColor} className="text-4xl" />
                  </button>
                ))}
              </div>
              <button onClick={() => setPromoting(null)} className="mt-3 text-sm text-white/50 hover:text-white">
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ChessBadge({ player }: { player: number }) {
  return (
    <span className={`flex size-8 items-center justify-center rounded-full ${player === 0 ? 'bg-[#e3d6ff]' : 'bg-[#9b7fe0]'}`}>
      <Piece type="k" color={player === 0 ? 'w' : 'b'} className="text-2xl" />
    </span>
  )
}
