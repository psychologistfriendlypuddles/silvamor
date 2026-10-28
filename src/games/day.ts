import { findFirstBlockAfter, type Block } from '../lib/bitcoin'

// Silvamor's daily games run from 00:00 to 00:00 UTC, each seeded by that day's first Bitcoin
// block (docs/PROTOCOL.md, "The day's seed block").

/** The UTC date a run belongs to, as YYYY-MM-DD. */
export const dayOf = (date: Date) => date.toISOString().slice(0, 10)

/** When a day begins: 00:00 UTC, in unix seconds. */
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000

/** The day before `day` (YYYY-MM-DD). */
export const previousDay = (day: string) => dayOf(new Date((dayStart(day) - 86400) * 1000))

const blockKey = (day: string) => `silvamor:block:${day}`

/** The day's seed block: the first one mined at or after 00:00 UTC. Null until it's mined. */
export async function fetchDayBlock(day: string): Promise<Block | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(blockKey(day)) ?? 'null')
    if (saved) return saved as Block
  } catch {
    /* fetch it again */
  }
  const block = await findFirstBlockAfter(dayStart(day))
  if (block) {
    try {
      localStorage.setItem(blockKey(day), JSON.stringify(block))
    } catch {
      /* fetch it again next time */
    }
  }
  return block
}

/** Milliseconds until the next UTC midnight, when a new day's game starts. */
export function untilNextDay(now: Date) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return next - now.getTime()
}

/** When the day ends (the next 00:00 UTC) on the player's clock, e.g. "5:00 PM". */
export function dayEndsLocally(now = new Date()) {
  return new Date(now.getTime() + untilNextDay(now)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
