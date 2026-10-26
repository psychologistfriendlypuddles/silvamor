import type { AnyRules, Outcome } from '../games/types'
import type { ActionContent, GameAction } from './nostr/gameEvents'

export interface ReplayStep {
  action: GameAction
  /** State after this action. */
  state: unknown
  /** Strikes per player after this action, so a replay shows when each one landed. */
  strikes: number[]
}

export interface ReplayResult {
  started: boolean
  players: string[]
  state: unknown
  steps: ReplayStep[]
  outcome: Outcome | null
  /** Index into players of who acts next, or null when the game is over / not started. */
  turn: number | null
  /** The last accepted action: the next action must point at it and record a block no lower. */
  tip: { id: string; createdAt: number; n: number; block: number | null } | null
  /** Someone signed two competing valid moves on the same tip. */
  forked: boolean
  /** Strikes per player (index into players): filed, or implied by moves made late. */
  strikes: number[]
  /** Strikes run up since the tip that nobody has filed yet. They still count. */
  pendingStrikes: number
  /** Blocks at which those pending strikes landed, oldest first: what clients file as strike actions. */
  strikesDue: number[]
  /** Who each of those strikes is against (index into players). */
  strikesDueFor: number[]
  /** Filed plus pending strikes per player: what to show. */
  totalStrikes: number[]
  /** The block whose mining gives the player on turn their next strike. */
  nextStrikeAt: number | null
}

export interface ReplayOptions {
  /** Blocks per turn (listing `blocks` tag), or null for no turn clock. */
  blocks?: number | null
  /** Newest block known to exist. Actions recording a later block are ignored for now. Null = unknown. */
  knownHeight?: number | null
  /** Newest block treated as settled for strikes (a little behind knownHeight). Defaults to knownHeight. */
  settledHeight?: number | null
}

/** Three strikes and you're out. */
export const MAX_STRIKES = 3

type Anchor = { type: ActionContent['type']; block: number }

/**
 * The block whose mining gives the next strike (docs/PROTOCOL.md, "Turn clock"):
 * S blocks after the previous event, whether that was the game starting, the
 * opponent's move, or the player's previous strike.
 */
export function nextStrikeBlock(anchor: Anchor, blocks: number): number {
  return anchor.block + blocks
}

/** How many strikes have landed by the time block `height` is mined, counting from `anchor`. */
export function strikesBy(anchor: Anchor, blocks: number, height: number): number {
  const first = nextStrikeBlock(anchor, blocks)
  return height < first ? 0 : Math.floor((height - first) / blocks) + 1
}

const order = (a: GameAction, b: GameAction) =>
  a.event.created_at - b.event.created_at || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0)

/**
 * Deterministically rebuild a game from its (possibly messy, unordered,
 * partially invalid) action events. See docs/PROTOCOL.md, "Replay and validation".
 */
export function replay(rules: AnyRules, host: string, actions: GameAction[], opts: ReplayOptions = {}): ReplayResult {
  const S = opts.blocks ?? null
  const knownHeight = opts.knownHeight ?? null
  const settledHeight = opts.settledHeight ?? knownHeight
  const existsYet = (block: number) => knownHeight === null || block <= knownHeight

  const empty: ReplayResult = {
    started: false,
    players: [],
    state: rules.init(),
    steps: [],
    outcome: null,
    turn: null,
    tip: null,
    forked: false,
    strikes: [],
    pendingStrikes: 0,
    strikesDue: [],
    strikesDueFor: [],
    totalStrikes: [],
    nextStrikeAt: null,
  }

  const start = actions
    .filter((a) => {
      const c = a.content
      return (
        c?.type === 'start' &&
        a.event.pubkey === host &&
        !a.prev &&
        // A clocked game needs to know which block it started at.
        (S === null || (a.block !== undefined && existsYet(a.block))) &&
        Array.isArray(c.players) &&
        c.players.length === rules.players &&
        new Set(c.players).size === c.players.length &&
        c.players.every((p) => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p))
      )
    })
    .sort(order)[0]
  if (!start || start.content?.type !== 'start') return empty

  const players = start.content.players
  const children = new Map<string, GameAction[]>()
  for (const a of actions) {
    if (!a.prev || !a.content) continue
    const list = children.get(a.prev) ?? []
    list.push(a)
    children.set(a.prev, list)
  }

  let state = rules.init()
  let outcome: Outcome | null = null
  let tip = start
  let anchor: Anchor = { type: 'start', block: start.block ?? 0 }
  let n = 0
  let forked = false
  let strikes = players.map(() => 0)
  const steps: ReplayStep[] = [{ action: start, state, strikes }]
  const other = (i: number) => (i + 1) % players.length

  type Candidate = { action: GameAction; state: unknown; outcome: Outcome | null; strikes: number[] }

  while (!outcome) {
    const onTurn = rules.turn(state)
    const candidates = (children.get(tip.event.id) ?? []).sort(order)
    const valid: Candidate[] = []

    for (const action of candidates) {
      const c = action.content!
      if (c.n !== n + 1) continue
      const block = action.block
      if (S !== null && (block === undefined || block < anchor.block || !existsYet(block))) continue
      const player = players.indexOf(action.event.pubkey)

      if (c.type === 'strike') {
        // Anyone may file a strike, but only at exactly the block where it landed.
        if (S === null || block !== nextStrikeBlock(anchor, S)) continue
        const next = [...strikes]
        next[onTurn] += 1
        const out: Outcome | null = next[onTurn] >= MAX_STRIKES ? { winner: other(onTurn), reason: 'strikes' } : null
        valid.push({ action, state: rules.onStrike?.(state, onTurn) ?? state, outcome: out, strikes: next })
      } else if (c.type === 'resign') {
        if (player < 0) continue
        valid.push({ action, state, outcome: { winner: other(player), reason: 'resign' }, strikes })
      } else if (c.type === 'move') {
        if (player < 0) continue
        // A late move brings the strikes it ran up; if that makes three, the player had already lost.
        const late = S !== null && player === onTurn ? strikesBy(anchor, S, block!) : 0
        if (strikes[player] + late >= MAX_STRIKES) continue
        // Where a strike passes the turn on, a move made after it landed is too late.
        if (late > 0 && rules.onStrike) continue
        try {
          const next = rules.apply(state, rules.parseMove(c.move), player)
          const counted = [...strikes]
          counted[player] += late
          valid.push({ action, state: next, outcome: rules.outcome(next), strikes: counted })
        } catch {
          /* illegal move: ignore */
        }
      }
    }

    if (valid.length === 0) break
    // A filed strike beats any competing action: a move can't be backdated past it.
    const chosen = valid.find((v) => v.action.content?.type === 'strike') ?? valid[0]
    // Equivocation only counts when the same player signed two competing moves.
    if (valid.some((v) => v !== chosen && v.action.content?.type !== 'strike' && v.action.event.pubkey === chosen.action.event.pubkey)) {
      forked = true
    }

    state = chosen.state
    outcome = chosen.outcome
    strikes = chosen.strikes
    tip = chosen.action
    anchor = { type: chosen.action.content!.type, block: chosen.action.block ?? anchor.block }
    n += 1
    steps.push({ action: chosen.action, state, strikes })
  }

  // Strikes that have landed since the tip but aren't filed yet, one at a time: each
  // lands S blocks after the previous one and may pass the turn on (rules.onStrike).
  let turn: number | null = outcome ? null : rules.turn(state)
  const totalStrikes = [...strikes]
  const strikesDue: number[] = []
  const strikesDueFor: number[] = []
  let nextStrikeAt: number | null = null

  if (turn !== null && S !== null) {
    let at = nextStrikeBlock(anchor, S)
    while (turn !== null && settledHeight !== null && at <= settledHeight) {
      totalStrikes[turn] += 1
      strikesDue.push(at)
      strikesDueFor.push(turn)
      if (totalStrikes[turn] >= MAX_STRIKES) {
        outcome = { winner: other(turn), reason: 'strikes' }
        turn = null
        break
      }
      state = rules.onStrike?.(state, turn) ?? state
      turn = rules.turn(state)
      at += S
    }
    if (turn !== null) nextStrikeAt = at
  }
  const pendingStrikes = strikesDue.length

  return {
    started: true,
    players,
    state,
    steps,
    outcome,
    turn,
    tip: { id: tip.event.id, createdAt: tip.event.created_at, n, block: tip.block ?? null },
    forked,
    strikes,
    pendingStrikes,
    strikesDue,
    strikesDueFor,
    totalStrikes,
    nextStrikeAt,
  }
}
