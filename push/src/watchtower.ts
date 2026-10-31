import { SimplePool, useWebSocketImplementation as setWebSocketImplementation } from 'nostr-tools/pool'
import { RelaySocket } from '../../scripts/relay-socket.mjs'
import { MINER_RUN_KIND, madeOnItsDay, parseMinerRun, type MinerRun } from '../../src/lib/nostr/minerRuns'
import { dayOf, dayStart, previousDay } from '../../src/games/day'
import type { PushSubscriptionData, Store } from './store'

// Streak reminders: a few hours before the day ends (midnight UTC), subscribers whose streak
// reached yesterday and who haven't played today get one push.

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
  /** The time now (ms), for tests. */
  now?: () => number
  log?: (message: string) => void
}

const DAY_SECONDS = 24 * 3600
/** Players reminded at once, so one slow push service can't hold everyone else up. */
const AT_ONCE = 8

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

  /** Each author's first run of the day (the one that counts). */
  async function firstRuns(authors: string[], days: string[]): Promise<Map<string, MinerRun>> {
    const filters = Array.from({ length: Math.ceil(authors.length / 500) }, (_, i) => ({
      kinds: [MINER_RUN_KIND],
      authors: authors.slice(i * 500, i * 500 + 500),
      '#l': days,
    }))
    const events = (await Promise.all(filters.map((f) => pool.querySync(opts.relays, f, { maxWait: 6000 })))).flat()
    const first = new Map<string, MinerRun>()
    for (const run of events.map(parseMinerRun)) {
      if (!run || !days.includes(run.day) || !madeOnItsDay(run)) continue
      const id = `${run.author}:${run.day}`
      const other = first.get(id)
      if (!other || run.createdAt < other.createdAt || (run.createdAt === other.createdAt && run.event.id < other.event.id)) first.set(id, run)
    }
    return first
  }

  async function remind() {
    const at = Math.floor(now() / 1000)
    const day = dayOf(new Date(at * 1000))
    const ends = dayStart(day) + DAY_SECONDS
    if (at < ends - before) return
    const id = `streak:${day}`
    const pending = opts.store.pubkeys().filter((p) => !opts.store.wasSent(p, id))
    if (pending.length === 0) return
    const yesterday = previousDay(day)
    const runs = await firstRuns(pending, [yesterday, day])
    await eachConcurrently(pending, AT_ONCE, async (pubkey) => {
      if (closed) return
      if (runs.has(`${pubkey}:${day}`)) {
        opts.store.markSent(pubkey, [id]) // played today: nothing to remind
        return
      }
      // No streak to keep (or the relay didn't answer): look again next time.
      const streak = runs.get(`${pubkey}:${yesterday}`)?.streak
      if (!streak) return
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
    running ??= remind()
      .catch((err) => log(`reminders failed: ${err instanceof Error ? err.message : err}`))
      .finally(() => (running = null))
    return running
  }

  const every = opts.every ?? 5 * 60_000
  const timer = every > 0 ? setInterval(tick, every) : null
  if (timer) void tick()

  return {
    tick,
    close() {
      closed = true
      if (timer) clearInterval(timer)
      pool.destroy()
    },
  }
}

export type Watchtower = ReturnType<typeof createWatchtower>
