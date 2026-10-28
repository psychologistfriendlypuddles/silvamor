import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Event } from 'nostr-tools/pure'
import { pool } from '../lib/nostr/pool'
import { gameReadRelays } from '../stores/relays'

/**
 * Follows the day's runs of one game (`kind`, labelled with `day`) by these authors, live.
 * `count` turns the events seen into each author's run that counts, or null while that can't be
 * worked out yet (the seed block or deal is still loading). `add` takes a run just published here
 * without waiting for relays.
 */
export function useGameRuns<R>(kind: number, day: string, authors: string[], count: ((events: Event[]) => Map<string, R>) | null) {
  const [events, setEvents] = useState(() => new Map<string, Event>())
  // Which set of authors relays have answered for: `loaded` only once the current one is in.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const authorsKey = [...new Set(authors)].sort().join(',')
  const ready = count !== null

  const add = useCallback((e: Event) => setEvents((all) => (all.has(e.id) ? all : new Map(all).set(e.id, e))), [])

  useEffect(() => {
    if (!ready || !authorsKey) return
    const list = authorsKey.split(',')
    let pending = 0
    const subs: { close(): void }[] = []
    for (let i = 0; i < list.length; i += 500) {
      pending++
      subs.push(
        pool.subscribe(gameReadRelays(), { kinds: [kind], '#l': [day], authors: list.slice(i, i + 500) }, {
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
  }, [kind, day, ready, authorsKey, add])

  const runs = useMemo(() => (count ? count([...events.values()]) : new Map<string, R>()), [count, events])
  return { runs, loaded: loadedKey === authorsKey, add }
}
