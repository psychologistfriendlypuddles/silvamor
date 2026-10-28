import { useCallback } from 'react'
import type { Event } from 'nostr-tools/pure'
import { DAILY_RUN_KIND, countedRuns, parseRun, type DailyRun } from '../lib/nostr/dailyRuns'
import type { Block } from '../lib/bitcoin'
import { useGameRuns } from './useGameRuns'

/** The day's Daily Deal runs by these authors, live: each author's run that counts. */
export function useDailyRuns(day: string, block: Block | null, authors: string[]) {
  const count = useCallback(
    (events: Event[]) => countedRuns(events.map(parseRun).filter((r): r is DailyRun => r !== null && r.day === day), block!, null),
    [day, block],
  )
  return useGameRuns(DAILY_RUN_KIND, day, authors, block ? count : null)
}
