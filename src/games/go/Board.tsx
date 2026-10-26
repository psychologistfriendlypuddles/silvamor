import { useMemo } from 'react'
import type { BoardProps } from '../ui'
import { IntersectionBoard } from '../IntersectionBoard'
import { Button } from '../../components/ui'
import { goRules, score, type GoMove, type GoState } from './rules'

export function GoBoard({ state, outcome, me, canMove, onMove }: BoardProps<GoState, GoMove>) {
  const rules = useMemo(() => goRules(state.size), [state.size])
  // Points where a stone would be suicide or repeat a position aren't offered.
  const legalPoints = useMemo(() => {
    if (!canMove) return new Set<number>()
    return new Set(
      state.board
        .map((_, point) => point)
        .filter((point) => {
          try {
            rules.apply(state, { point }, state.turn)
            return true
          } catch {
            return false
          }
        }),
    )
  }, [rules, state, canMove])
  const legal = (point: number) => legalPoints.has(point)
  const ended = !!outcome
  const final = ended ? score(state) : null
  return (
    <div className="flex flex-col gap-3">
      <IntersectionBoard
        size={state.size}
        stones={state.board}
        last={state.last}
        territory={final?.territory}
        me={me}
        canMove={canMove}
        legal={legal}
        onPlay={(point) => onMove({ point })}
      />
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-white/60">
        <span>
          Captured: ⚫ {state.captures[0]} · ⚪ {state.captures[1]}
        </span>
        {final && (
          <span className="font-semibold text-white/80">
            Score: ⚫ {final.black} · ⚪ {final.white}
          </span>
        )}
        {!ended && state.passes === 1 && (
          <span className="text-lemon">{me < 0 ? 'A player passed.' : state.turn === me ? 'Your opponent passed.' : 'You passed.'} Two passes end the game.</span>
        )}
        {canMove && (
          <Button variant="secondary" onClick={() => onMove({ pass: true })}>
            Pass
          </Button>
        )}
      </div>
    </div>
  )
}
