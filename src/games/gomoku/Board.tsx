import type { BoardProps } from '../ui'
import { IntersectionBoard } from '../IntersectionBoard'
import { SIZE, type GomokuMove, type GomokuState } from './rules'

export function GomokuBoard({ state, outcome, me, canMove, onMove }: BoardProps<GomokuState, GomokuMove>) {
  return (
    <IntersectionBoard
      size={SIZE}
      stones={state.cells}
      last={state.last}
      line={outcome && 'winner' in outcome ? outcome.line : undefined}
      me={me}
      canMove={canMove}
      onPlay={(cell) => onMove({ cell })}
    />
  )
}
