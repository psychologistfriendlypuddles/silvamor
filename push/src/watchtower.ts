import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { DAILY_RUN_KIND } from '../../src/lib/nostr/dailyRuns'
import { beatenNotice, type Notice, type RunLookup } from '../../src/lib/notifications'
import { noticeText } from '../../src/lib/noticeText'
import { displayName, parseProfile, type ProfileContent } from '../../src/lib/nostr/profile'
import { dayStart } from '../../src/games/dailydeal/daily'
import type { Block } from '../../src/lib/bitcoin'
import type { PushSubscriptionData, Store } from './store'

// The same check the app uses decides what's worth a notification (src/lib/notifications.ts),
// so the app and this service can't disagree.

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
  relays: string[]
  store: Store
  /** Delivers one push. 'gone' means the subscription expired and is removed. */
  send(sub: PushSubscriptionData, payload: PushPayload): Promise<SendResult>
  /** The first Bitcoin block at or after `time` (unix seconds): a day's seed block. Null until mined. */
  findBlock(time: number): Promise<Block | null>
  /** Where the app lives, e.g. https://www.silvamor.com, for links in notifications. */
  appUrl: string
  log?: (message: string) => void
}

/** Runs that beat someone stay worth a push this long. */
const RECENT_SECONDS = 2 * 24 * 3600
/** Follow lists are fetched again after this long. */
const FOLLOWS_TTL_MS = 10 * 60_000

export function createWatchtower(opts: WatchtowerOptions) {
  const log = opts.log ?? (() => {})
  const pool = new SimplePool({ enableReconnect: true })
  const profiles = new Map<string, ProfileContent>()
  const blocks = new Map<string, Block>()
  const follows = new Map<string, { at: number; set: Promise<Set<string>> }>()
  let sub: { close(): void } | null = null
  // Runs are handled one at a time, so a run arriving twice can't be pushed twice.
  let queue = Promise.resolve()
  let closed = false

  function followsOf(pubkey: string): Promise<Set<string>> {
    const cached = follows.get(pubkey)
    if (cached && Date.now() - cached.at < FOLLOWS_TTL_MS) return cached.set
    const set = pool
      .get(opts.relays, { kinds: [3], authors: [pubkey] }, { maxWait: 4000 })
      .then((e) => new Set((e?.tags ?? []).filter((t) => t[0] === 'p').map((t) => t[1])))
    follows.set(pubkey, { at: Date.now(), set })
    return set
  }

  const lookup: RunLookup = {
    follows: async (me, author) => (await followsOf(me)).has(author),
    async dayBlock(day) {
      if (!blocks.has(day)) {
        const block = await opts.findBlock(dayStart(day))
        if (block) blocks.set(day, block)
      }
      return blocks.get(day) ?? null
    },
    runs: (authors, day) => pool.querySync(opts.relays, { kinds: [DAILY_RUN_KIND], authors, '#l': [day] }, { maxWait: 4000 }),
  }

  /** Every subscriber a run tags as beaten gets one push, if it checks out. */
  async function handle(run: Event) {
    const subscribers = new Set(opts.store.pubkeys())
    const tagged = run.tags.filter((t) => t[0] === 'p' && subscribers.has(t[1])).map((t) => t[1])
    for (const pubkey of tagged) {
      const id = `beaten:${run.id}`
      if (closed || opts.store.wasSent(pubkey, id)) continue
      const notice = await beatenNotice(run, pubkey, lookup).catch(() => null)
      if (!notice) continue
      opts.store.markSent(pubkey, [id]) // first, so a slow push can't go out twice
      await loadProfiles([notice.actor])
      await deliver(pubkey, toPayload(notice))
    }
  }

  function resubscribe() {
    sub?.close()
    const pubkeys = opts.store.pubkeys()
    sub =
      pubkeys.length === 0
        ? null
        : pool.subscribe(
            opts.relays,
            { kinds: [DAILY_RUN_KIND], '#p': pubkeys, since: Math.floor(Date.now() / 1000) - RECENT_SECONDS },
            { onevent: (e) => (queue = queue.then(() => handle(e)).catch(() => {})) },
          )
  }

  async function deliver(pubkey: string, payload: PushPayload) {
    for (const s of opts.store.subscriptionsFor(pubkey)) {
      const result = await opts.send(s, payload).catch((): SendResult => 'error')
      if (result === 'gone') opts.store.removeSubscription(s.endpoint)
      log(`push ${result}: ${payload.body}`)
    }
  }

  function toPayload(notice: Notice): PushPayload {
    const name = displayName(profiles.get(notice.actor), nip19.npubEncode(notice.actor))
    const { emoji, text } = noticeText(notice, name)
    return { title: 'Silvamor', body: `${emoji} ${text}`, url: `${opts.appUrl}/`, tag: `dailydeal:${notice.day}` }
  }

  async function loadProfiles(pubkeys: string[]) {
    const missing = [...new Set(pubkeys)].filter((p) => !profiles.has(p))
    if (missing.length === 0) return
    const found = await pool.querySync(opts.relays, { kinds: [0], authors: missing }, { maxWait: 3000 }).catch(() => [])
    for (const e of found.sort((a, b) => a.created_at - b.created_at)) profiles.set(e.pubkey, parseProfile(e))
  }

  resubscribe()

  return {
    /**
     * Call after someone subscribes: runs that already tag them count as sent (no flood
     * of old news), then their new ones are watched.
     */
    async subscribed(pubkey: string) {
      const since = Math.floor(Date.now() / 1000) - RECENT_SECONDS
      const old = await pool.querySync(opts.relays, { kinds: [DAILY_RUN_KIND], '#p': [pubkey], since }, { maxWait: 4000 })
      opts.store.markSent(pubkey, old.map((e) => `beaten:${e.id}`))
      follows.delete(pubkey)
      resubscribe()
    },
    /** Re-follow after someone unsubscribes. */
    unsubscribed: () => resubscribe(),
    /** For tests: wait for the runs seen so far to be handled. */
    settled: () => queue,
    close() {
      closed = true
      sub?.close()
      pool.destroy()
    },
  }
}

export type Watchtower = ReturnType<typeof createWatchtower>
