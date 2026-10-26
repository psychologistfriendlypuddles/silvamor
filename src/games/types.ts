/**
 * How a game ended. `reason: 'strikes'` means the loser collected three strikes by
 * letting the turn clock run out: that's what reliability ratings count.
 */
export type Outcome = { winner: number; line?: number[]; reason?: 'rules' | 'resign' | 'strikes' } | { draw: true }

export class IllegalMove extends Error {}

/**
 * Pure rules for one game type. State must be treated as immutable so replays
 * can be computed step by step and compared.
 */
export interface GameRules<S, M> {
  id: string
  name: string
  emoji: string
  players: number
  init(): S
  /** Index into the players array of whoever moves next. */
  turn(state: S): number
  /** Throws IllegalMove when the move isn't allowed. */
  apply(state: S, move: M, player: number): S
  outcome(state: S): Outcome | null
  /** Validates untrusted JSON from an event into a move. */
  parseMove(raw: unknown): M
  /**
   * Rules for a variant chosen when the game was created (listing `option` tags,
   * e.g. a board size), or null if those options aren't supported.
   */
  configure?(options: Record<string, string>): GameRules<S, M> | null
  /**
   * What a turn-clock strike does to the game. Without this the struck player keeps
   * the turn; with it (e.g. dots and boxes) the strike can pass the turn on.
   */
  onStrike?(state: S, player: number): S
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRules = GameRules<any, any>
