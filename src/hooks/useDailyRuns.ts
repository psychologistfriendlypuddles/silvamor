import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Event } from 'nostr-tools/pure'
import { pool } from '../lib/nostr/pool'
import { DAILY_RUN_KIND, countedRuns, parseRun } from '../lib/nostr/dailyRuns'
import type { Block } from '../lib/bitcoin'
import { gameReadRelays } from '../stores/relays'

/**
 * Follows the day's Daily Deal runs by these authors, live. `runs` holds each author's
 * run that counts; `add` takes a run just published here without waiting for relays.
 */
export function useDailyRuns(day: string, block: Block | null, authors: string[]) {
  const [events, setEvents] = useState(() => new Map<string, Event>())
  // Which set of authors relays have answered for: `loaded` only once the current one is in.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const authorsKey = [...new Set(authors)].sort().join(',')

  const add = useCallback((e: Event) => setEvents((all) => (all.has(e.id) ? all : new Map(all).set(e.id, e))), [])

  useEffect(() => {
    if (!block || !authorsKey) return
    const list = authorsKey.split(',')
    let pending = 0
    const subs: { close(): void }[] = []
    for (let i = 0; i < list.length; i += 500) {
      pending++
      subs.push(
        pool.subscribe(gameReadRelays(), { kinds: [DAILY_RUN_KIND], '#l': [day], authors: list.slice(i, i + 500) }, {
          onevent: add,
          oneose: () => --pending <= 0 && setLoadedKey(authorsKey),
        }),
      )
    }
    const fallback = setTimeout(() => setLoadedKey(authorsKey), 6000) // a silent relay mustn't hold the page up
    return () => {
      clearTimeout(fallback)
      subs.forEach((s) => s.close())
    }
  }, [day, block, authorsKey, add])

  const runs = useMemo(() => {
    if (!block) return new Map()
    const parsed = [...events.values()].map(parseRun).filter((r) => r !== null && r.day === day)
    return countedRuns(parsed as NonNullable<(typeof parsed)[number]>[], block, null)
  }, [day, block, events])

  return { runs, loaded: loadedKey === authorsKey, add }
}
