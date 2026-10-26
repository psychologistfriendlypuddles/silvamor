export const DEFAULT_RELAYS: string[]

export interface GameStats {
  days: number
  from: string
  to: string
  total: number
  finished: number
  perDay: { day: string; games: number }[]
  byGame: { game: string; name: string; games: number }[]
}

export function collectStats(options?: { relays?: string[]; days?: number; now?: number; maxWait?: number }): Promise<GameStats>
