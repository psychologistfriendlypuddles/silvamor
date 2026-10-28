import { useEffect, useState } from 'react'
import { HOME_RELAY, pool } from '../lib/nostr/pool'
import { DAILY_RUN_KIND, parseRun, previousDay } from '../lib/nostr/dailyRuns'

/**
 * The streaks these players' runs the day before `day` claim, by player. Only from Silvamor's
 * relay, which checks each run's streak against the day before when it takes it, so a streak
 * made up elsewhere doesn't count (docs/PROTOCOL.md, "Streaks").
 */
export function useStreaks(day: string, authors: string[]) {
  const [streaks, setStreaks] = useState(() => new Map<string, number[]>())
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const authorsKey = [...new Set(authors)].sort().join(',')

  useEffect(() => {
    if (!authorsKey) return
    let cancelled = false
    const list = authorsKey.split(',')
    const yesterday = previousDay(day)
    const chunks = Array.from({ length: Math.ceil(list.length / 500) }, (_, i) => list.slice(i * 500, i * 500 + 500))
    Promise.all(chunks.map((authors) => pool.querySync([HOME_RELAY], { kinds: [DAILY_RUN_KIND], '#l': [yesterday], authors }, { maxWait: 6000 }))).then(
      (results) => {
        if (cancelled) return
        const found = new Map<string, number[]>()
        for (const run of results.flat().map(parseRun)) {
          if (run?.day === yesterday) found.set(run.author, [...(found.get(run.author) ?? []), run.streak])
        }
        setStreaks(found)
        setLoadedKey(authorsKey)
      },
      () => !cancelled && setLoadedKey(authorsKey),
    )
    return () => {
      cancelled = true
    }
  }, [day, authorsKey])

  return { streaks, loaded: loadedKey === authorsKey }
}
