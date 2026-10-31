import { SimplePool, useWebSocketImplementation as setWebSocketImplementation } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools/filter'
import type { Event } from 'nostr-tools/pure'
import { RelaySocket } from '../../scripts/relay-socket.mjs'
import { askRelay } from '../../src/lib/nostr/ask'
import { MINER_RUN_KIND, madeOnItsDay, parseMinerRun, type MinerRun } from '../../src/lib/nostr/minerRuns'
import { dayOf, dayStart, previousDay } from '../../src/games/day'
import type { PushSubscriptionData, Store } from './store'

// Streak reminders: a few hours before the day ends (midnight UTC), subscribers whose streak
// reached yesterday and who haven't played today get one push. Only players keep subscriptions:
// signing up needs a game from the last 30 days, and 30 days without one lets a key go.

// A relay that can't be reached mustn't end the service, as it can with Node's own WebSocket.
setWebSocketImplementation(RelaySocket)

export interface PushPayload {
  title: string
  body: string
  /** Opened when the notification is tapped. */
  url: string
  /** Replaces an earlier notification about the same day. */
  tag: string
}

export type SendResult = 'ok' | 'gone' | 'error'

export interface WatchtowerOptions {
  /** Where runs are kept: Silvamor's relay, whose guard checks each run's streak. */
  relays: string[]
  store: Store
  /** Delivers one push. 'gone' means the subscription expired and is removed. */
  send(sub: PushSubscriptionData, payload: PushPayload): Promise<SendResult>
  /** Where the app lives, e.g. https://www.silvamor.com, for links in notifications. */
  appUrl: string
  /** How long before the day ends to remind, in hours (default 4). */
  remindHoursBefore?: number
  /** How often to look, in milliseconds (default 5 minutes); 0 never looks by itself (tests call `tick`). */
  every?: number
  /** How long one push may take before it counts as an error, in milliseconds (default 15 seconds). */
  sendTimeoutMs?: number
  /** How long the relays have to answer a lookup, in milliseconds (default 6 seconds). */
  relayWaitMs?: number
  /** The time now (ms), for tests. */
  now?: () => number
  log?: (message: string) => void
}

const DAY_SECONDS = 24 * 3600
/** Players reminded at once, so one slow push service can't hold everyone else up. */
const AT_ONCE = 8
/** How long after the relays last answered for a player they're looked up again. */
const LOOK_AGAIN_MS = 2 * 3600_000
/** Players not seen playing (or signing up) for this long are let go: Silvamor's relay lets their runs go then too. */
const FORGET_AFTER_MS = 30 * 24 * 3600_000

/** What `promise` gives, or `otherwise` if it takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number, otherwise: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([promise, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(otherwise), ms)))]).finally(() => clearTimeout(timer))
}

/** Runs `task` on every item, at most `limit` at a time. */
async function eachConcurrently<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await task(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export function createWatchtower(opts: WatchtowerOptions) {
  const log = opts.log ?? (() => {})
  const now = opts.now ?? Date.now
  const before = (opts.remindHoursBefore ?? 4) * 3600
  const pool = new SimplePool({ enableReconnect: true })
  let running: Promise<void> | null = null
  let closed = false

  /**
   * What the relays have for `filter`, and whether they all answered: one that doesn't may hold what
   * we're looking for, so nothing is decided on its silence.
   */
  async function lookUp(filter: Filter): Promise<{ events: Event[]; answered: boolean }> {
    const answers = await Promise.allSettled(opts.relays.map((relay) => askRelay(pool, relay, filter, opts.relayWaitMs ?? 6000)))
    return { events: answers.flatMap((a) => (a.status === 'fulfilled' ? a.value : [])), answered: answers.every((a) => a.status === 'fulfilled') }
  }

  /** Each author's first run of the day (the one that counts), and the authors the relays answered for. */
  async function firstRuns(authors: string[], days: string[]) {
    const chunks = Array.from({ length: Math.ceil(authors.length / 500) }, (_, i) => authors.slice(i * 500, i * 500 + 500))
    const answers = await Promise.all(chunks.map((chunk) => lookUp({ kinds: [MINER_RUN_KIND], authors: chunk, '#l': days })))
    const answered = new Set(chunks.filter((_, i) => answers[i].answered).flat())
    const first = new Map<string, MinerRun>()
    for (const run of answers.flatMap((a) => a.events).map(parseMinerRun)) {
      if (!run || !days.includes(run.day) || !madeOnItsDay(run)) continue
      const id = `${run.author}:${run.day}`
      const other = first.get(id)
      if (!other || run.createdAt < other.createdAt || (run.createdAt === other.createdAt && run.event.id < other.event.id)) first.set(id, run)
    }
    return { first, answered }
  }

  /** Whether `pubkey` has a run that counts from the last 30 days; null if the relays didn't all answer and none was found. */
  async function hasPlayed(pubkey: string): Promise<boolean | null> {
    const since = Math.floor((now() - FORGET_AFTER_MS) / 1000)
    const { events, answered } = await lookUp({ kinds: [MINER_RUN_KIND], authors: [pubkey], since, limit: 100 })
    if (events.map(parseMinerRun).some((run) => !!run && madeOnItsDay(run))) return true
    return answered ? false : null
  }

  async function remind() {
    const at = Math.floor(now() / 1000)
    const day = dayOf(new Date(at * 1000))
    const ends = dayStart(day) + DAY_SECONDS
    if (at < ends - before) return
    const id = `streak:${day}`
    const due = opts.store.due(id, now() - LOOK_AGAIN_MS)
    if (due.length === 0) return
    const yesterday = previousDay(day)
    const { first: runs, answered } = await firstRuns(due, [yesterday, day])
    opts.store.checked([...answered], now())
    opts.store.seen([...new Set([...runs.values()].map((run) => run.author))], now())
    // Without an answer, a player is looked up again next round; with one, in 2 hours.
    await eachConcurrently(due.filter((pubkey) => answered.has(pubkey)), AT_ONCE, async (pubkey) => {
      if (closed) return
      if (runs.has(`${pubkey}:${day}`)) {
        opts.store.markSent(pubkey, [id]) // played today: nothing to remind
        return
      }
      const streak = runs.get(`${pubkey}:${yesterday}`)?.streak
      if (!streak) return // no streak to keep
      opts.store.markSent(pubkey, [id]) // first, so a slow push can't go out twice
      const hours = Math.max(1, Math.round((ends - at) / 3600))
      await deliver(pubkey, {
        title: 'Silvamor',
        body: `🔥 Your ${streak}-day streak ends in ${hours} hour${hours === 1 ? '' : 's'}. Play today to keep it going.`,
        url: `${opts.appUrl}/`,
        tag: id,
      })
    })
  }

  /** Lets go of players with no game in 30 days, and of notices about days before yesterday. */
  function forget() {
    const day = dayOf(new Date(now()))
    const gone = opts.store.forget(now() - FORGET_AFTER_MS, [`streak:${previousDay(day)}`, `streak:${day}`])
    if (gone) log(`let go of ${gone} player${gone === 1 ? '' : 's'} with no game in 30 days`)
  }

  async function deliver(pubkey: string, payload: PushPayload) {
    for (const s of opts.store.subscriptionsFor(pubkey)) {
      // A push service that doesn't answer in time counts as an error, rather than holding up the rest.
      const result = await within(opts.send(s, payload).catch((): SendResult => 'error'), opts.sendTimeoutMs ?? 15_000, 'error')
      if (result === 'gone') opts.store.removeSubscription(s.endpoint)
      log(`push ${result}: ${payload.body}`)
    }
  }

  /** Looks for anyone to remind now; one look at a time. */
  function tick(): Promise<void> {
    running ??= (async () => {
      forget()
      await remind()
    })()
      .catch((err) => log(`reminders failed: ${err instanceof Error ? err.message : err}`))
      .finally(() => (running = null))
    return running
  }

  const every = opts.every ?? 5 * 60_000
  const timer = every > 0 ? setInterval(tick, every) : null
  if (timer) void tick()

  return {
    tick,
    hasPlayed,
    close() {
      closed = true
      if (timer) clearInterval(timer)
      pool.destroy()
    },
  }
}

export type Watchtower = ReturnType<typeof createWatchtower>
