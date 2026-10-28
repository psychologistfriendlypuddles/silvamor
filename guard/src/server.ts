import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import protobuf from 'protobufjs'
import { bytesToHex } from 'nostr-tools/utils'
import type { Event } from 'nostr-tools/pure'
import { findFirstBlockAfter } from '../../src/lib/bitcoin'
import { dayStart } from '../../src/games/day'
import { fetchDeal } from '../../src/games/miner/deal'
import { MINER_RUN_KIND } from '../../src/lib/nostr/minerRuns'
import { createPolicy, type Policy } from './policy'
import { VANISH_KIND, erase, parseRetention, prune, pruneNonPlayers, storedStreaks, sweepRuns, vanishRequests, type Retention } from './cleanup'
import nauthzProto from '../proto/nauthz.proto?raw'

// Silvamor relay guard: nostr-rs-relay asks it about every event before storing it (gRPC
// "event admission", see deploy/nostr-rs-relay.toml), once a day it deletes old events from the
// relay's database, and it deletes everything from a key that asks to vanish. See guard/README.md.

/**
 * What the privacy policy promises (src/pages/Legal.tsx, "Our relay"): game runs and tip receipts are
 * deleted after 30 days; sprite reports are kept so moderation keeps working. Replaceable events
 * need no rule: the relay keeps only the newest (and profiles, follow lists and relay lists only
 * while their key has runs here, see `pruneNonPlayers`). 1952 is the retired Daily Deal's runs: no
 * new ones are taken, and the rule clears the last of them.
 */
export const DEFAULT_RETENTION = '1952:30,1953:30,9735:30'

/**
 * How far back each sweep after the first looks (seconds): a run can fail some time after it
 * arrived, once the day before's run it extends is deleted, and a later sweep has to see it.
 */
const SWEEP_WINDOW = 2 * 3600

export interface GuardConfig {
  /** Where to listen for the relay, e.g. 0.0.0.0:50051. */
  listen: string
  /** The relay's public address, which requests to vanish must name. */
  relayUrl: string
  blockSources: string[]
  perIpMinute: number
  perIpDay: number
  /** Bytes one IP address may have kept each day (runs and requests to vanish aside). */
  perIpDayBytes: number
  /** The relay's SQLite file, for cleanup and requests to vanish. Without it there's neither. */
  relayDb: string | null
  retention: Retention[]
  /** Only count what cleanup would delete. */
  dryRun: boolean
}

export function configFromEnv(env = process.env): GuardConfig {
  const list = (v: string | undefined, fallback: string[]) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback)
  return {
    listen: env.LISTEN ?? '0.0.0.0:50051',
    relayUrl: env.RELAY_URL ?? 'wss://relay.silvamor.com',
    blockSources: list(env.BLOCK_SOURCES, ['https://mempool.space/api/blocks/tip/height', 'https://blockstream.info/api/blocks/tip/height']),
    perIpMinute: Number(env.PER_IP_MINUTE ?? 60),
    perIpDay: Number(env.PER_IP_DAY ?? 2000),
    perIpDayBytes: Number(env.PER_IP_DAY_MB ?? 20) * 1024 * 1024,
    relayDb: env.RELAY_DB || null,
    retention: parseRetention(env.RETENTION ?? DEFAULT_RETENTION),
    dryRun: env.DRY_RUN !== 'false',
  }
}

interface WireEvent {
  id: Buffer
  pubkey: Buffer
  created_at: number
  kind: number
  content: string
  tags: { values: string[] }[]
  sig: Buffer
}

/** The relay's protobuf event, as a Nostr event (the relay has already checked its signature). */
export function fromWire(e: WireEvent): Event {
  return {
    id: bytesToHex(e.id),
    pubkey: bytesToHex(e.pubkey),
    created_at: Number(e.created_at),
    kind: Number(e.kind),
    content: e.content,
    tags: (e.tags ?? []).map((t) => t.values ?? []),
    sig: bytesToHex(e.sig),
  }
}

// `defaults`: protobuf leaves out fields at their zero value (a kind-0 profile arrives with no kind).
const packageDefinition = protoLoader.fromJSON(protobuf.parse(nauthzProto, { keepCase: true }).root.toJSON(), {
  keepCase: true,
  longs: Number,
  enums: Number,
  defaults: true,
})
const nauthz = grpc.loadPackageDefinition(packageDefinition).nauthz as unknown as { Authorization: grpc.ServiceClientConstructor }
const PERMIT = 1
const DENY = 2
/** The health check's dummy author, left out of the log. */
const HEALTH_PUBKEY = '0'.repeat(64)

/**
 * The streaks a key's stored runs claim on a day, for checking a streak's link to the day before; null
 * (not checked) without the relay's database, or for a day clean-up may already have emptied. So runs
 * deleted after 30 days don't break a streak, also when the sweep checks old runs again.
 */
export function streaksFrom(config: Pick<GuardConfig, 'relayDb' | 'retention'>, now = () => Date.now()) {
  const keptDays = config.retention.find((r) => r.kind === MINER_RUN_KIND)?.days
  return (pubkey: string, day: string) => {
    if (!config.relayDb || (keptDays !== undefined && dayStart(day) < now() / 1000 - keptDays * 86400)) return null
    return storedStreaks(config.relayDb, pubkey, day)
  }
}

export function startGuard(config: GuardConfig, deps: { policy?: Policy; log?: (m: string) => void } = {}) {
  const log = deps.log ?? ((m: string) => console.log(m))
  // Keys that asked to vanish, and when: kept in the relay itself, as their requests.
  const vanished = new Map<string, number>()
  if (config.relayDb) {
    try {
      for (const [pubkey, at] of vanishRequests(config.relayDb)) vanished.set(pubkey, at)
    } catch (err) {
      log(`couldn't read requests to vanish: ${err instanceof Error ? err.message : err}`)
    }
  }
  const policy =
    deps.policy ??
    createPolicy({
      findBlock: (t) => findFirstBlockAfter(t, config.blockSources),
      findDeal: (day, block) => fetchDeal(day, block, config.blockSources),
      perIpMinute: config.perIpMinute,
      perIpDay: config.perIpDay,
      perIpDayBytes: config.perIpDayBytes,
      relayUrl: config.relayUrl,
      vanishedAt: (pubkey) => vanished.get(pubkey),
      streaksOn: streaksFrom(config),
      log,
    })
  const server = new grpc.Server()
  server.addService(nauthz.Authorization.service, {
    EventAdmit(call: grpc.ServerUnaryCall<{ event: WireEvent; ip_addr?: string }, unknown>, callback: grpc.sendUnaryData<unknown>) {
      const event = fromWire(call.request.event)
      const ip = call.request.ip_addr || undefined
      policy
        .decide(event, { ip })
        .then((d) => (d.permit && event.kind === VANISH_KIND ? vanish(event) : d))
        .then((d) => {
          if (!d.permit && event.pubkey !== HEALTH_PUBKEY) log(`deny kind ${event.kind} ${event.id} from ${ip ?? 'unknown address'}: ${d.message}`)
          callback(null, { decision: d.permit ? PERMIT : DENY, message: d.message })
        })
        // On a bug, let the event in, as the relay does when the guard is unreachable. But not a run,
        // which boards take this relay's word for, or a request to vanish, which would be kept while
        // nothing was deleted.
        .catch((err) => {
          const refuse = event.kind === MINER_RUN_KIND || event.kind === VANISH_KIND
          log(`error on ${event.id}, ${refuse ? 'refusing' : 'admitting'}: ${err instanceof Error ? err.message : err}`)
          callback(null, refuse ? { decision: DENY, message: 'something went wrong here, try again' } : { decision: PERMIT })
        })
    },
  })

  /** Deletes what the request's author published here, before the relay stores the request. */
  function vanish(event: Event) {
    if (!config.relayDb) return { permit: false, message: "this relay can't delete events on request; ask its operator" }
    try {
      const n = erase(config.relayDb, event.pubkey, event.created_at)
      // A key with nothing kept here has nothing to forget, so its request isn't kept either: anyone
      // could otherwise pile up requests from throwaway keys for good. (The app takes this as done.)
      if (n === 0 && !vanished.has(event.pubkey)) return { permit: false, message: 'nothing from this key is kept here' }
      vanished.set(event.pubkey, Math.max(event.created_at, vanished.get(event.pubkey) ?? 0))
      log(`request to vanish: deleted ${n} events`)
      return { permit: true }
    } catch (err) {
      log(`request to vanish failed: ${err instanceof Error ? err.message : err}`)
      return { permit: false, message: "couldn't delete your events, please try again" }
    }
  }

  // Cleanup: shortly after starting, then daily.
  const cleanup = () => {
    if (!config.relayDb) return
    try {
      const counts = prune(config.relayDb, config.retention, { dryRun: config.dryRun })
      const nonPlayers = pruneNonPlayers(config.relayDb, { dryRun: config.dryRun })
      const kinds = Object.entries(counts).map(([k, n]) => `kind ${k}: ${n}, `).join('')
      log(`cleanup${config.dryRun ? ' (dry run, nothing deleted)' : ''}: ${kinds}profiles, follow lists and relay lists of keys with no runs: ${nonPlayers}`)
    } catch (err) {
      log(`cleanup failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  const first = setTimeout(cleanup, 60_000)
  const daily = setInterval(cleanup, 24 * 3600_000)

  // Sweep: while the guard can't be reached, the relay stores events unchecked, and boards take its
  // word for runs. So every minute, runs it stored lately are checked again, as each reached it, and
  // the ones that fail are deleted: all stored runs the first time, then the last two hours'.
  let sweptAll = false
  let sweeping = false
  const sweep = async () => {
    if (!config.relayDb || sweeping) return
    sweeping = true
    try {
      const since = sweptAll ? Math.floor(Date.now() / 1000) - SWEEP_WINDOW : 0
      const { checked, failed, later } = await sweepRuns(config.relayDb, since, policy.recheck, { dryRun: config.dryRun })
      const removed = [...failed.values()].reduce((sum, n) => sum + n, 0)
      if (!sweptAll || removed) {
        const reasons = [...failed].map(([why, n]) => `${n}× ${why}`).join('; ')
        log(`sweep${config.dryRun ? ' (dry run, nothing deleted)' : ''}: ${checked} run${checked === 1 ? '' : 's'} checked, ${removed} failed${removed ? ` (${reasons})` : ''}${later ? `, ${later} couldn't be checked yet` : ''}`)
      }
      sweptAll = true
    } catch (err) {
      log(`sweep failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      sweeping = false
    }
  }
  const sweeps = setInterval(sweep, 60_000)

  return new Promise<{ port: number; cleanup(): void; sweep(): Promise<void>; close(): Promise<void> }>((resolve, reject) => {
    server.bindAsync(config.listen, grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err)
      resolve({
        port,
        cleanup,
        sweep,
        close: () =>
          new Promise<void>((done) => {
            clearTimeout(first)
            clearInterval(daily)
            clearInterval(sweeps)
            server.tryShutdown(() => done())
          }),
      })
    })
  })
}

/**
 * For Docker's health check: asks the running guard about a dummy note (always refused) and
 * resolves true if it answered within 3 seconds, so a hung guard counts as unhealthy too.
 */
export function checkHealth(listen: string): Promise<boolean> {
  const port = listen.split(':').pop()
  const client = new nauthz.Authorization(`127.0.0.1:${port}`, grpc.credentials.createInsecure()) as unknown as grpc.Client & {
    EventAdmit(req: unknown, opts: grpc.CallOptions, cb: (err: Error | null, reply?: { decision: number }) => void): void
  }
  const dummy = { id: Buffer.alloc(32), pubkey: Buffer.alloc(32), created_at: 0, kind: 1, content: '', tags: [], sig: Buffer.alloc(64) }
  return new Promise((resolve) =>
    client.EventAdmit({ event: dummy }, { deadline: Date.now() + 3000 }, (err, reply) => {
      client.close()
      resolve(!err && reply?.decision === DENY)
    }),
  )
}

// Run directly (see guard/README.md); `--health` checks a running guard instead.
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--health')) {
  checkHealth(configFromEnv().listen).then((ok) => process.exit(ok ? 0 : 1))
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const config = configFromEnv()
  startGuard(config).then(({ port }) =>
    console.log(
      `Silvamor relay guard on :${port}; cleanup ${config.relayDb && config.retention.length ? `of ${config.relayDb}${config.dryRun ? ' (dry run)' : ''}` : 'off'}`,
    ),
  )
}
