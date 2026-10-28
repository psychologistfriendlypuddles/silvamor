import { useEffect, useState } from 'react'
import { HOME_RELAY, pool } from '../lib/nostr/pool'
import { MINER_RUN_KIND, madeOnItsDay, parseMinerRun, type MinerRun } from '../lib/nostr/minerRuns'
import { dayOf, previousDay } from '../games/day'

/**
 * Runs on these days from Silvamor's relay, by `authors` (or everyone): each player's first run of
 * each day (the one that counts). The relay replays every run against its day's transactions before
 * keeping it (and checks its streak), so boards take its scores as they are, leaving out only runs
 * not made on their day. Null while loading; with `refreshMs`, asked again that often.
 */
export function useBoardRuns(days: string[], authors?: string[], refreshMs?: number): MinerRun[] | null {
  const key = `${days.join(',')}|${authors ? [...authors].sort().join(',') : '*'}`
  const [state, setState] = useState<{ key: string; runs: MinerRun[] | null }>({ key: '', runs: null })
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!refreshMs) return
    const timer = setInterval(() => setRound((n) => n + 1), refreshMs)
    return () => clearInterval(timer)
  }, [refreshMs])
  useEffect(() => {
    let cancelled = false
    const [dayList, authorList] = key.split('|')
    const wanted = dayList.split(',')
    const who = authorList === '*' ? null : authorList.split(',')
    const filters = who
      ? Array.from({ length: Math.ceil(who.length / 500) }, (_, i) => ({ kinds: [MINER_RUN_KIND], authors: who.slice(i * 500, i * 500 + 500), '#l': wanted }))
      : [{ kinds: [MINER_RUN_KIND], '#l': wanted }]
    Promise.all(filters.map((f) => pool.querySync([HOME_RELAY], f, { maxWait: 8000 })))
      .then((found) => {
        if (cancelled) return
        const first = new Map<string, MinerRun>()
        for (const run of found.flat().map(parseMinerRun)) {
          if (!run || !wanted.includes(run.day) || !madeOnItsDay(run)) continue
          const id = `${run.author}:${run.day}`
          const other = first.get(id)
          if (!other || run.createdAt < other.createdAt || (run.createdAt === other.createdAt && run.event.id < other.event.id)) first.set(id, run)
        }
        setState({ key, runs: [...first.values()] })
      })
      .catch(() => !cancelled && setState({ key, runs: [] }))
    return () => {
      cancelled = true
    }
  }, [key, round])
  return state.key === key ? state.runs : null
}

/** The last `n` days, today first. */
export function lastDays(n: number): string[] {
  const days = [dayOf(new Date())]
  while (days.length < n) days.push(previousDay(days[days.length - 1]))
  return days
}

/** The time windows boards add fees up over. */
export const WINDOWS = [
  { id: '1', title: 'Today' },
  { id: '7', title: '7 days' },
  { id: '21', title: '21 days' },
] as const
export type Window = (typeof WINDOWS)[number]['id']

/**
 * Each player's fees over the runs, added up, best first (earlier first run breaks a tie), with
 * their current streak: their latest run's, if it's from today or yesterday.
 */
export function feeTotals(runs: MinerRun[]): { author: string; fees: number; streak: number }[] {
  const today = dayOf(new Date())
  const alive = new Set([today, previousDay(today)])
  const totals = new Map<string, { fees: number; firstAt: number; latest: MinerRun }>()
  for (const run of runs) {
    const t = totals.get(run.author)
    if (!t) totals.set(run.author, { fees: run.score, firstAt: run.createdAt, latest: run })
    else totals.set(run.author, { fees: t.fees + run.score, firstAt: Math.min(t.firstAt, run.createdAt), latest: run.createdAt > t.latest.createdAt ? run : t.latest })
  }
  return [...totals]
    .sort(([, a], [, b]) => b.fees - a.fees || a.firstAt - b.firstAt)
    .map(([author, t]) => ({ author, fees: t.fees, streak: alive.has(t.latest.day) ? t.latest.streak : 0 }))
}
