import type { Event } from 'nostr-tools/pure'
import { parseRun, previousDay, verifyRun } from '../../src/lib/nostr/dailyRuns'
import { dayStart } from '../../src/games/dailydeal/daily'
import { FEATURED_D, MAX_REPORT_NOTE } from '../../src/lib/moderation'
import { parseSprite } from '../../src/lib/sprites'
import type { Block } from '../../src/lib/bitcoin'

// What relay.silvamor.com accepts (docs/DEPLOY.md, "Relays"). The relay's own config already
// refuses other kinds and oversized events; this adds the checks a config file can't express.

const tag = (e: Event, name: string) => e.tags.find((t) => t[0] === name)?.[1]
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
  1952: { maxBytes: 8_192 },
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

export interface Decision {
  permit: boolean
  /** Why, on a refusal. The relay shows it to the client as "blocked: <message>" (NIP-01 "OK"). */
  message?: string
}

export interface PolicyOptions {
  /** The first Bitcoin block at or after `time` (unix seconds): a day's seed block. Null until mined. */
  findBlock(time: number): Promise<Block | null>
  /** Events one author may publish per minute. */
  perMinute: number
  /**
   * Events one IP address may publish per minute and per day, whatever keys it uses, so
   * throwaway keys don't get around `perMinute`. Generous, because many players can share an
   * address (a school, an office, a mobile network).
   */
  perIpMinute: number
  perIpDay: number
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
  const blocks = new Map<string, Block>()
  const authorMinute = rateLimit(60_000, opts.perMinute, now)
  const ipMinute = rateLimit(60_000, opts.perIpMinute, now)
  const ipDay = rateLimit(24 * 3600_000, opts.perIpDay, now)

  async function dayBlock(day: string): Promise<Block | null> {
    if (!blocks.has(day)) {
      const block = await opts.findBlock(dayStart(day))
      if (block) blocks.set(day, block)
    }
    return blocks.get(day) ?? null
  }

  async function checkRun(event: Event): Promise<Decision> {
    const run = parseRun(event)
    if (!run) return deny('not a Daily Deal run')
    let block: Block | null
    try {
      block = await dayBlock(run.day)
    } catch (err) {
      // Block sources down: let it in rather than lose a real run (clients check runs anyway).
      log(`no block source for ${run.day}, admitting run ${event.id}: ${err instanceof Error ? err.message : err}`)
      return permit
    }
    if (!block) return deny(`no Daily Deal for ${run.day} yet`)
    if (!verifyRun(run, block, null)) return deny("the run doesn't replay to its score")
    // A streak links to the day before: that day's run here must claim one day less.
    if (run.streak > 1) {
      const before = opts.streaksOn?.(event.pubkey, previousDay(run.day))
      if (before && !before.includes(run.streak - 1)) return deny(`a ${run.streak}-day streak needs a ${run.streak - 1}-day streak the day before`)
    }
    return permit
  }

  return {
    /** `from.ip`: the sender's address, as the relay saw it (absent when it doesn't say). */
    async decide(event: Event, from: { ip?: string } = {}): Promise<Decision> {
      const rule = KINDS[event.kind]
      if (!rule) return deny(`Silvamor's relay doesn't keep kind ${event.kind}`)
      // Every limit counts every attempt, so a sender who keeps pushing stays blocked.
      const ipOverMinute = from.ip ? ipMinute(from.ip) : false
      const ipOverDay = from.ip ? ipDay(from.ip) : false
      const authorOver = authorMinute(event.pubkey)
      if (ipOverDay) return deny('too many events from your network today, try again tomorrow')
      if (ipOverMinute || authorOver) return deny('too many events, slow down')
      // A key that asked to vanish stays forgotten: what it published before can't be uploaded again.
      const vanished = opts.vanishedAt?.(event.pubkey)
      if (vanished !== undefined && event.created_at <= vanished && event.kind !== 62) return deny('this key asked this relay to delete its events')
      if (new TextEncoder().encode(JSON.stringify(event)).length > rule.maxBytes) return deny(`kind ${event.kind} events are limited to ${rule.maxBytes / 1024} KB here`)
      const wrong = rule.wrong?.(event)
      if (wrong) return deny(wrong)
      if (event.kind === 62 && !event.tags.some((t) => t[0] === 'relay' && (t[1] === 'ALL_RELAYS' || sameRelay(t[1] ?? '', opts.relayUrl)))) {
        return deny(`a request to vanish here names ${opts.relayUrl}`)
      }
      if (event.kind === 1952) return checkRun(event)
      return permit
    },
  }
}

export type Policy = ReturnType<typeof createPolicy>
