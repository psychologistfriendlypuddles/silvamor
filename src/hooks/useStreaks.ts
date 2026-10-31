import { useEffect, useState } from 'react'
import { HOME_RELAY, queryOrFail } from '../lib/nostr/pool'
import { MINER_RUN_KIND, madeOnItsDay, parseMinerRun } from '../lib/nostr/minerRuns'
import { previousDay } from '../games/day'

/** How long before asking Silvamor's relay again when it didn't answer (ms). */
const RETRY_MS = 10_000

/**
 * The streaks these players' runs the day before `day` claim, by player. Only from Silvamor's
 * relay, which checks each run's streak against the day before when it takes it, so a streak
 * made up elsewhere doesn't count (docs/PROTOCOL.md, "Streaks"). `loaded` only once the relay has
 * answered: a run published before then would claim a first day, and end the player's streak for
 * good, since only a day's first run counts. When it doesn't answer, `unreachable` says so, and
 * it's asked again every 10 seconds.
 */
export function useStreaks(day: string, authors: string[]) {
  const [streaks, setStreaks] = useState(() => new Map<string, number[]>())
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const key = `${day}|${[...new Set(authors)].sort().join(',')}`

  useEffect(() => {
    const [forDay, authorList] = key.split('|')
    if (!authorList) return
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const list = authorList.split(',')
    const yesterday = previousDay(forDay)
    const chunks = Array.from({ length: Math.ceil(list.length / 500) }, (_, i) => list.slice(i * 500, i * 500 + 500))
    Promise.all(chunks.map((authors) => queryOrFail(HOME_RELAY, { kinds: [MINER_RUN_KIND], '#l': [yesterday], authors })))
      .then((results) => {
        if (cancelled) return
        const found = new Map<string, number[]>()
        for (const run of results.flat().map(parseMinerRun)) {
          if (run?.day === yesterday && madeOnItsDay(run)) found.set(run.author, [...(found.get(run.author) ?? []), run.streak])
        }
        setStreaks(found)
        setLoadedKey(key)
      })
      .catch(() => {
        if (cancelled) return
        setFailedKey(key)
        retry = setTimeout(() => setRound((n) => n + 1), RETRY_MS)
      })
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [key, round])

  return { streaks, loaded: loadedKey === key, unreachable: failedKey === key && loadedKey !== key }
}
