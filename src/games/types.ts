export class IllegalMove extends Error {}

/**
 * Pure rules for a one-player game. State must be treated as immutable so a run can be
 * replayed step by step and checked.
 */
export interface Rules<S, M> {
  init(): S
  /** Throws IllegalMove when the move isn't allowed. */
  apply(state: S, move: M): S
  /** The final score once the run is over, else null. */
  outcome(state: S): { score: number } | null
  /** Validates untrusted JSON from an event into a move. */
  parseMove(raw: unknown): M
}
