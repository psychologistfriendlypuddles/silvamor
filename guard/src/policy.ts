import type { Event } from 'nostr-tools/pure'
import { dayOf, dayStart, previousDay } from '../../src/games/day'
import { FEATURED_D, MAX_REPORT_NOTE } from '../../src/lib/moderation'
import { parseSprite } from '../../src/lib/sprites'
import type { Block } from '../../src/lib/bitcoin'
import { madeOnItsDay, parseMinerRun, verifyMinerRun } from '../../src/lib/nostr/minerRuns'
import type { MinerDeal } from '../../src/games/miner/rules'

// What relay.silvamor.com accepts (docs/DEPLOY.md, "Relays"). The relay's own config already
// refuses other kinds and oversized events; this adds the checks a config file can't express.

const tag = (e: Event, name: string) => e.tags.find((t) => t[0] === name)?.[1]
/** An event's size as JSON, in bytes. */
const sizeOf = (e: Event) => new TextEncoder().encode(JSON.stringify(e)).length
const isJsonObject = (text: string) => {
  try {
    const v = JSON.parse(text)
    return !!v && typeof v === 'object' && !Array.isArray(v)
  } catch {
    return false
  }
}

/**
 * What each kind Silvamor publishes to its relay may look like (deploy/nostr-rs-relay.toml lists the
 * same kinds): the biggest it may be, as JSON, and a check of its shape that returns what's wrong.
 * Anything else is junk. Follow lists come from any Nostr app and can be long, so they only get a
 * size cap; everything Silvamor writes itself is held well below the relay's own limit.
 */
const KINDS: Record<number, { maxBytes: number; wrong?: (e: Event) => string | null }> = {
  0: { maxBytes: 16_384, wrong: (e) => (isJsonObject(e.content) ? null : 'a profile is a JSON object') },
  3: { maxBytes: 262_144 },
  5: { maxBytes: 2_048, wrong: (e) => (e.tags.some((t) => t[0] === 'a' || t[0] === 'e') ? null : 'a deletion names what it deletes') },
  62: { maxBytes: 2_048 }, // request to vanish (NIP-62): checked against this relay's address below
  1953: { maxBytes: 4_096 }, // Block of the Day runs: checked by replaying them below
  1984: {
    maxBytes: 1_024,
    wrong: (e) =>
      !tag(e, 'a')?.startsWith('30951:') || !tag(e, 'p')
        ? 'reports here are about sprites'
        : e.content.length > MAX_REPORT_NOTE
          ? `report notes are limited to ${MAX_REPORT_NOTE} characters`
          : null,
  },
  9735: { maxBytes: 8_192, wrong: (e) => (tag(e, 'bolt11') && tag(e, 'description') ? null : 'a zap receipt carries its invoice and request') },
  10002: { maxBytes: 16_384, wrong: (e) => (e.tags.every((t) => (t[0] === 'r' && /^wss?:\/\//.test(t[1] ?? '')) || t[0] === 'alt' || t[0] === 'client') ? null : 'a relay list holds only relays') },
  30000: { maxBytes: 65_536, wrong: (e) => (tag(e, 'd') ? null : 'a group needs an id') },
  30004: { maxBytes: 65_536, wrong: (e) => (tag(e, 'd') === FEATURED_D ? null : "only Silvamor's featured sprites") },
  30078: { maxBytes: 16_384, wrong: (e) => (tag(e, 'd')?.startsWith('silvamor/') ? null : "only Silvamor's own settings") },
  30951: { maxBytes: 8_192, wrong: (e) => (tag(e, 't') === 'silvamor' && parseSprite(e) ? null : 'not a Silvamor sprite') },
}

/**
 * How far a run's time may be from the relay's clock when it arrives (seconds). The app publishes a run
 * as it's made, so anything further off is a copy uploaded later, or a past day played after the fact
 * to make up a streak.
 */
const RUN_SKEW = 30 * 60
/** How long before asking the block sources again about a day they had nothing for: not mined yet, or no answer (ms). */
const RETRY_MS = 15_000
/** How long a sweep waits for a day's block and deal to be read: no one is waiting on its answer (ms). */
const SWEEP_WAIT_MS = 30_000

/** Waits for `promise`, but no longer than `ms` (it carries on after that). */
async function waitAtMost(promise: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([promise, new Promise((resolve) => (timer = setTimeout(resolve, ms)))])
  clearTimeout(timer)
}

export interface Decision {
  permit: boolean
  /** Why, on a refusal. The relay shows it to the client as "blocked: <message>" (NIP-01 "OK"). */
  message?: string
  /** Refused only because it can't be checked yet (a run whose day can't be read now): a sweep leaves it for next time. */
  later?: boolean
}

export interface PolicyOptions {
  /** The first Bitcoin block at or after `time` (unix seconds): a day's seed block. Null until mined. */
  findBlock(time: number): Promise<Block | null>
  /** A day's Block of the Day deal, read from its seed block's transactions. */
  findDeal(day: string, block: Block): Promise<MinerDeal>
  /** How long a run may wait for its day's block and deal to be read before it's refused for now (default 2.5 s). */
  lookupMs?: number
  /**
   * Events one IP address may publish per minute and per day, whatever keys it uses. Generous,
   * because many players can share an address (a school, an office, a mobile network).
   */
  perIpMinute: number
  perIpDay: number
  /**
   * Bytes of events one IP address may have kept here each day (UTC), whatever keys it uses, so
   * nobody can fill the relay's disk. Runs and requests to vanish don't count: runs are small,
   * counted by `perIpDay` and deleted after 30 days, and a request to vanish must always get through.
   */
  perIpDayBytes: number
  /** This relay's address, which a request to vanish must name (or ALL_RELAYS). */
  relayUrl: string
  /** The streaks `pubkey`'s stored runs for `day` claim; null when unknown (then streaks aren't checked). */
  streaksOn?(pubkey: string, day: string): number[] | null
  /** When `pubkey` last asked this relay to forget it (unix seconds), if it has. */
  vanishedAt?(pubkey: string): number | undefined
  now?: () => number
  log?: (message: string) => void
}

/**
 * Counts events per key (an author or an IP address) over a sliding window. Each call records one
 * and says whether that key is now over `limit`. Only the newest `limit + 1` times are kept per key.
 */
function rateLimit(windowMs: number, limit: number, now: () => number) {
  const seen = new Map<string, number[]>()
  return (key: string): boolean => {
    const t = now()
    const times = (seen.get(key) ?? []).filter((x) => t - x < windowMs).slice(-limit)
    times.push(t)
    seen.set(key, times)
    if (seen.size > 10_000) for (const [k, ts] of seen) if (ts.every((x) => t - x >= windowMs)) seen.delete(k)
    return times.length > limit
  }
}

const sameRelay = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase()

const permit: Decision = { permit: true }
const deny = (message: string): Decision => ({ permit: false, message })

export function createPolicy(opts: PolicyOptions) {
  const now = opts.now ?? (() => Date.now())
  const log = opts.log ?? (() => {})
  const ipMinute = rateLimit(60_000, opts.perIpMinute, now)
  const ipDay = rateLimit(24 * 3600_000, opts.perIpDay, now)

  /** Each day's seed block and deal, once read. Runs are only taken for today and yesterday, so older days are dropped. */
  const games = new Map<string, { block: Block; deal: MinerDeal }>()
  /** Days being read now, and when to ask again about days the block sources had nothing for. */
  const reading = new Set<string>()
  const retryAt = new Map<string, number>()

  async function readGame(day: string) {
    try {
      const block = await opts.findBlock(dayStart(day))
      if (block) {
        const deal = await opts.findDeal(day, block)
        for (const old of games.keys()) if (old < previousDay(day)) games.delete(old)
        games.set(day, { block, deal })
        return
      }
    } catch (err) {
      log(`no block source for ${day}: ${err instanceof Error ? err.message : err}`)
    }
    retryAt.set(day, now() + RETRY_MS)
  }

  /**
   * The day's seed block and deal, or undefined when they can't be had right now. The relay waits for
   * every answer, so they're read (a few requests to the block sources) once at a time per day, not
   * again for a while after the sources had nothing, and no run waits on that longer than `waitMs`.
   */
  async function dayGame(day: string, waitMs: number) {
    if (!games.has(day) && !reading.has(day) && now() >= (retryAt.get(day) ?? 0)) {
      reading.add(day)
      await waitAtMost(readGame(day).finally(() => reading.delete(day)), waitMs)
    }
    return games.get(day)
  }

  /** A run as it reached the relay at `at` (unix seconds), waiting up to `waitMs` for its day to be read. */
  async function checkMinerRun(event: Event, at: number, waitMs: number): Promise<Decision> {
    const run = parseMinerRun(event)
    if (!run) return deny('not a Block of the Day run')
    // Checked before the block sources are asked anything, so junk can't keep them (and the relay) busy.
    if (!madeOnItsDay(run)) return deny(`a run for ${run.day} has to be made that day`)
    if (Math.abs(at - run.createdAt) > RUN_SKEW) return deny("this run wasn't made just now (is your clock right?)")
    // Boards take this relay's word for runs, so one it can't check now is refused: the player can try again.
    const game = await dayGame(run.day, waitMs)
    if (!game) return { ...deny(`can't check runs for ${run.day} yet, try again in a minute`), later: true }
    if (!verifyMinerRun(run, game.block, game.deal)) return deny("the run doesn't replay to its fees")
    // A streak links to the day before: that day's run here must claim one day less.
    if (run.streak > 1) {
      const before = opts.streaksOn?.(event.pubkey, previousDay(run.day))
      if (before && !before.includes(run.streak - 1)) return deny(`a ${run.streak}-day streak needs a ${run.streak - 1}-day streak the day before`)
    }
    return permit
  }

  /** Whether an event belongs here, but for the rate limits: as it reached the relay at `at` (unix seconds). */
  async function check(event: Event, at: number, waitMs: number): Promise<Decision> {
    const rule = KINDS[event.kind]
    if (!rule) return deny(`Silvamor's relay doesn't keep kind ${event.kind}`)
    // A key that asked to vanish stays forgotten: what it published before can't be uploaded again.
    const vanished = opts.vanishedAt?.(event.pubkey)
    if (vanished !== undefined && event.created_at <= vanished && event.kind !== 62) return deny('this key asked this relay to delete its events')
    if (sizeOf(event) > rule.maxBytes) return deny(`kind ${event.kind} events are limited to ${rule.maxBytes / 1024} KB here`)
    const wrong = rule.wrong?.(event)
    if (wrong) return deny(wrong)
    if (event.kind === 62 && !event.tags.some((t) => t[0] === 'relay' && (t[1] === 'ALL_RELAYS' || sameRelay(t[1] ?? '', opts.relayUrl)))) {
      return deny(`a request to vanish here names ${opts.relayUrl}`)
    }
    if (event.kind === 1953) return checkMinerRun(event, at, waitMs)
    return permit
  }

  /** Bytes kept here today (UTC) from each IP address. */
  let today = ''
  const bytesToday = new Map<string, number>()

  /** Counts `bytes` against `ip`'s budget for today, unless they'd go over it (then says so). */
  function overBudget(ip: string, bytes: number) {
    const day = dayOf(new Date(now()))
    if (day !== today) {
      today = day
      bytesToday.clear()
    }
    const total = (bytesToday.get(ip) ?? 0) + bytes
    if (total > opts.perIpDayBytes) return true
    bytesToday.set(ip, total)
    return false
  }

  return {
    /** `from.ip`: the sender's address, as the relay saw it (absent when it doesn't say). */
    async decide(event: Event, from: { ip?: string } = {}): Promise<Decision> {
      // The limits count every attempt at a kind kept here, so a sender who keeps pushing stays blocked.
      // They're per address, not per key: a key's events are public, so anyone could send them again
      // to use up the key's limit and lock its owner out.
      if (KINDS[event.kind] && from.ip) {
        const overMinute = ipMinute(from.ip)
        const overDay = ipDay(from.ip)
        if (overDay) return deny('too many events from your network today, try again tomorrow')
        if (overMinute) return deny('too many events, slow down')
      }
      const decision = await check(event, now() / 1000, opts.lookupMs ?? 2500)
      if (decision.permit && from.ip && event.kind !== 1953 && event.kind !== 62 && overBudget(from.ip, sizeOf(event))) {
        return deny('too much data from your network today, try again tomorrow')
      }
      return decision
    },
    /**
     * Checks a stored event again, as it reached the relay at `at` (its `first_seen`, unix seconds), for
     * the sweep: the same rules without the rate limits, waiting longer for a run's day to be read.
     */
    recheck: (event: Event, at: number) => check(event, at, SWEEP_WAIT_MS),
  }
}

export type Policy = ReturnType<typeof createPolicy>
