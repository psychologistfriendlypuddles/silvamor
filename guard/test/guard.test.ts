import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import protobuf from 'protobufjs'
import { hexToBytes } from 'nostr-tools/utils'
import { finalizeEvent, generateSecretKey, type Event, type EventTemplate } from 'nostr-tools/pure'
import { buildRun } from '../../src/lib/nostr/dailyRuns'
import { dailyDealRules, type DailyDealMove } from '../../src/games/dailydeal/rules'
import { dayOf, dayStart, seedFor } from '../../src/games/dailydeal/daily'
import { createPolicy } from '../src/policy'
import { parseRetention, prune } from '../src/cleanup'
import { checkHealth, configFromEnv, startGuard } from '../src/server'
import nauthzProto from '../proto/nauthz.proto?raw'

const day = dayOf(new Date())
const block = { height: 900_000, hash: 'ab'.repeat(32), timestamp: dayStart(day) + 60 }
const sk = generateSecretKey()
const sign = (t: Partial<EventTemplate> & { kind: number }) => finalizeEvent({ created_at: Math.floor(Date.now() / 1000), tags: [], content: '', ...t }, sk)

/** A finished run on today's deal, playing the first card each hand. */
function run(scoreOffset = 0) {
  const rules = dailyDealRules(seedFor(day, block.hash))
  let state = rules.init()
  const moves: DailyDealMove[] = []
  while (!rules.outcome(state)) {
    const move = { play: [state.hand[0]] }
    state = rules.apply(state, move)
    moves.push(move)
  }
  return finalizeEvent(buildRun({ day, block, moves, score: state.score + scoreOffset, beaten: [] }), sk)
}

describe('admission policy', () => {
  const policy = () => createPolicy({ findBlock: async () => block, perMinute: 100, perIpMinute: 1000, perIpDay: 100_000 })

  const sprite = 'a'.repeat(64)
  const report = (note: string, extra: string[][] = []) =>
    sign({ kind: 1984, content: note, tags: [['p', sprite, 'spam'], ['a', `30951:${sprite}:duck`, 'spam'], ['k', '30951'], ...extra] })

  it("admits what Silvamor publishes and refuses other kinds", async () => {
    const p = policy()
    const good = [
      sign({ kind: 0, content: JSON.stringify({ name: 'Alice' }) }),
      sign({ kind: 3, tags: [['p', sprite]] }),
      sign({ kind: 5, content: 'Group deleted', tags: [['a', `30000:${sprite}:abc`], ['k', '30000']] }),
      report('rude'),
      sign({ kind: 9735, tags: [['p', sprite], ['bolt11', 'lnbc210n1'], ['description', '{}']] }),
      sign({ kind: 10002, tags: [['r', 'wss://relay.silvamor.com'], ['r', 'wss://nos.lol', 'read']] }),
      sign({ kind: 30000, tags: [['d', 'abc'], ['title', 'Friends'], ['p', sprite]] }),
      sign({ kind: 30004, tags: [['d', 'silvamor-sprites'], ['a', `30951:${sprite}:duck`]] }),
      sign({ kind: 30078, tags: [['d', 'silvamor/sprite'], ['sprite', 'builtin:ostrich']] }),
      sign({
        kind: 30951,
        content: JSON.stringify({ version: 1, size: 64, animations: { idle: { row: 0, frames: 4, fps: 4 } } }),
        tags: [['d', 'duck'], ['title', 'Duck'], ['image', 'https://cdn.example/duck.png'], ['t', 'silvamor']],
      }),
    ]
    for (const e of good) expect(await p.decide(e), `kind ${e.kind}`).toEqual({ permit: true })
    expect(await p.decide(sign({ kind: 1, content: 'gm' }))).toEqual({ permit: false, message: "Silvamor's relay doesn't keep kind 1" })
  })

  it('refuses junk of an allowed kind', async () => {
    const p = policy()
    const junk: [Event, string][] = [
      [sign({ kind: 0, content: 'not json' }), 'a profile is a JSON object'],
      [sign({ kind: 0, content: JSON.stringify({ about: 'x'.repeat(20_000) }) }), 'kind 0 events are limited to 16 KB here'],
      [sign({ kind: 5, content: 'bye' }), 'a deletion names what it deletes'],
      [sign({ kind: 1984, tags: [['e', sprite]] }), 'reports here are about sprites'],
      [report('x'.repeat(84)), 'report notes are limited to 83 characters'],
      [report('ok', [['padding', 'x'.repeat(2_000)]]), 'kind 1984 events are limited to 1 KB here'],
      [sign({ kind: 9735, tags: [['p', sprite]] }), 'a zap receipt carries its invoice and request'],
      [sign({ kind: 10002, tags: [['r', 'wss://nos.lol'], ['junk', 'x']] }), 'a relay list holds only relays'],
      [sign({ kind: 30004, tags: [['d', 'my-bookmarks']] }), "only Silvamor's featured sprites"],
      [sign({ kind: 30951, tags: [['d', 'duck'], ['t', 'silvamor']] }), 'not a Silvamor sprite'],
    ]
    for (const [e, why] of junk) expect(await p.decide(e), why).toEqual({ permit: false, message: why })
  })

  it('lets long follow lists in', async () => {
    const follows = Array.from({ length: 3000 }, (_, i) => ['p', i.toString(16).padStart(64, '0')])
    expect((await policy().decide(sign({ kind: 3, tags: follows }))).permit).toBe(true)
  })

  it('refuses reports with long notes', async () => {
    const p = policy()
    expect((await p.decide(report('x'.repeat(83)))).permit).toBe(true)
    expect(await p.decide(report('x'.repeat(84)))).toEqual({ permit: false, message: 'report notes are limited to 83 characters' })
  })

  it("keeps only Silvamor's own kind-30078 settings", async () => {
    const p = policy()
    expect((await p.decide(sign({ kind: 30078, tags: [['d', 'silvamor/sprite']] }))).permit).toBe(true)
    expect((await p.decide(sign({ kind: 30078, tags: [['d', 'someapp/settings']] }))).permit).toBe(false)
  })

  it('admits runs that replay to their score, and no others', async () => {
    const p = policy()
    expect((await p.decide(run())).permit).toBe(true)
    expect(await p.decide(run(1))).toEqual({ permit: false, message: "the run doesn't replay to its score" })
    expect((await p.decide(sign({ kind: 1952, content: 'junk' }))).permit).toBe(false)
  })

  it("refuses runs for a day whose block isn't mined, and admits them when no block source answers", async () => {
    expect((await createPolicy({ findBlock: async () => null, perMinute: 100, perIpMinute: 1000, perIpDay: 100_000 }).decide(run())).permit).toBe(false)
    const down = createPolicy({ findBlock: async () => Promise.reject(new Error('offline')), perMinute: 100, perIpMinute: 1000, perIpDay: 100_000 })
    expect((await down.decide(run())).permit).toBe(true)
  })

  it('limits each author to a number of events a minute', async () => {
    let t = 0
    const p = createPolicy({ findBlock: async () => block, perMinute: 2, perIpMinute: 1000, perIpDay: 100_000, now: () => t })
    expect((await p.decide(sign({ kind: 3 }))).permit).toBe(true)
    expect((await p.decide(sign({ kind: 3 }))).permit).toBe(true)
    expect(await p.decide(sign({ kind: 3 }))).toEqual({ permit: false, message: "too many events, slow down" })
    t = 61_000
    expect((await p.decide(sign({ kind: 3 }))).permit).toBe(true)
  })
})

describe('limits per IP address', () => {
  /** A profile from a brand-new key each time: the throwaway-keys attack. */
  const throwaway = () => finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: '{}' }, generateSecretKey())

  it('caps one address per minute, however many keys it uses', async () => {
    let t = 0
    const p = createPolicy({ findBlock: async () => block, perMinute: 100, perIpMinute: 3, perIpDay: 100, now: () => t })
    for (let i = 0; i < 3; i++) expect((await p.decide(throwaway(), { ip: '203.0.113.7' })).permit).toBe(true)
    expect(await p.decide(throwaway(), { ip: '203.0.113.7' })).toEqual({ permit: false, message: 'too many events, slow down' })
    // Other addresses, and events whose address the relay didn't pass on, aren't affected.
    expect((await p.decide(throwaway(), { ip: '198.51.100.2' })).permit).toBe(true)
    expect((await p.decide(throwaway())).permit).toBe(true)
    t = 61_000
    expect((await p.decide(throwaway(), { ip: '203.0.113.7' })).permit).toBe(true)
  })

  it('caps one address per day', async () => {
    let t = 0
    const p = createPolicy({ findBlock: async () => block, perMinute: 100, perIpMinute: 100, perIpDay: 5, now: () => t })
    for (let i = 0; i < 5; i++) {
      t += 120_000
      expect((await p.decide(throwaway(), { ip: '203.0.113.7' })).permit).toBe(true)
    }
    t += 120_000
    expect(await p.decide(throwaway(), { ip: '203.0.113.7' })).toEqual({ permit: false, message: 'too many events from your network today, try again tomorrow' })
    t += 24 * 3600_000
    expect((await p.decide(throwaway(), { ip: '203.0.113.7' })).permit).toBe(true)
  })
})

describe('cleanup', () => {
  /** A database with nostr-rs-relay's event and tag tables (schema version 18). */
  function relayDb() {
    const path = join(mkdtempSync(join(tmpdir(), 'silvamor-guard-')), 'nostr.db')
    const db = new DatabaseSync(path)
    db.exec(`
      PRAGMA foreign_keys = ON; PRAGMA user_version = 18;
      CREATE TABLE event (id INTEGER PRIMARY KEY, event_hash BLOB NOT NULL, first_seen INTEGER NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER, author BLOB NOT NULL, delegated_by BLOB, kind INTEGER NOT NULL, hidden INTEGER, content TEXT NOT NULL);
      CREATE TABLE tag (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, name TEXT, value TEXT, value_hex BLOB, created_at INTEGER NOT NULL,
        kind INTEGER NOT NULL, FOREIGN KEY(event_id) REFERENCES event(id) ON UPDATE CASCADE ON DELETE CASCADE);
    `)
    const add = db.prepare('INSERT INTO event (event_hash, first_seen, created_at, author, kind, content) VALUES (?, 0, ?, x\'00\', ?, \'{}\')')
    const tag = db.prepare("INSERT INTO tag (event_id, name, value, created_at, kind) VALUES (?, 'l', 'x', ?, ?)")
    const now = 1_000 * 86400
    const rows: [number, number][] = [
      [1952, now - 100 * 86400], // old run
      [1952, now - 10 * 86400], // recent run
      [0, now - 400 * 86400], // old profile: not covered by the rule
    ]
    rows.forEach(([kind, at], i) => {
      const id = Number(add.run(new Uint8Array([i + 1]), at, kind).lastInsertRowid)
      tag.run(id, at, kind)
    })
    db.close()
    return { path, now }
  }
  const count = (path: string, sql: string) => {
    const db = new DatabaseSync(path)
    const n = (db.prepare(sql).get() as { n: number }).n
    db.close()
    return n
  }

  it('reads retention rules', () => {
    expect(parseRetention('1952:90, 1984:365')).toEqual([
      { kind: 1952, days: 90 },
      { kind: 1984, days: 365 },
    ])
    expect(parseRetention('')).toEqual([])
    expect(() => parseRetention('1952')).toThrow(/kind:days/)
  })

  it('deletes runs and tip receipts after 30 days by default, and keeps reports, as the privacy policy says', () => {
    expect(configFromEnv({}).retention).toEqual([
      { kind: 1952, days: 30 },
      { kind: 9735, days: 30 },
    ])
    expect(configFromEnv({}).dryRun).toBe(true)
  })

  it('counts without deleting in a dry run, then deletes old events and their tags', () => {
    const { path, now } = relayDb()
    expect(prune(path, [{ kind: 1952, days: 90 }], { dryRun: true, now })).toEqual({ 1952: 1 })
    expect(count(path, 'SELECT COUNT(*) AS n FROM event')).toBe(3)
    expect(prune(path, [{ kind: 1952, days: 90 }], { dryRun: false, now })).toEqual({ 1952: 1 })
    expect(count(path, 'SELECT COUNT(*) AS n FROM event')).toBe(2)
    expect(count(path, 'SELECT COUNT(*) AS n FROM tag')).toBe(2)
  })
})

describe('gRPC event admission', () => {
  let guard: Awaited<ReturnType<typeof startGuard>>
  let client: grpc.Client & { EventAdmit: (req: unknown, cb: (err: Error | null, reply: { decision: number; message?: string }) => void) => void }

  beforeAll(async () => {
    guard = await startGuard(
      { listen: '127.0.0.1:0', blockSources: [], perMinute: 100, perIpMinute: 1000, perIpDay: 100_000, relayDb: null, retention: [], dryRun: true },
      { policy: createPolicy({ findBlock: async () => block, perMinute: 100, perIpMinute: 2, perIpDay: 100_000 }), log: () => {} },
    )
    const def = protoLoader.fromJSON(protobuf.parse(nauthzProto, { keepCase: true }).root.toJSON(), { keepCase: true, longs: Number, enums: Number, defaults: true })
    const { Authorization } = grpc.loadPackageDefinition(def).nauthz as unknown as { Authorization: grpc.ServiceClientConstructor }
    client = new Authorization(`127.0.0.1:${guard.port}`, grpc.credentials.createInsecure()) as unknown as typeof client
  })
  afterAll(async () => {
    client.close()
    await guard.close()
  })

  /** Asks the guard about an event, as nostr-rs-relay does. */
  const admit = (e: Event, ip = '203.0.113.7') =>
    new Promise<{ decision: number; message?: string }>((resolve, reject) =>
      client.EventAdmit(
        {
          // Like nostr-rs-relay (Rust), leave out fields at zero: a profile's kind isn't sent at all.
          event: { id: hexToBytes(e.id), pubkey: hexToBytes(e.pubkey), created_at: e.created_at, ...(e.kind ? { kind: e.kind } : {}), content: e.content, tags: e.tags.map((values) => ({ values })), sig: hexToBytes(e.sig) },
          ip_addr: ip,
        },
        (err, reply) => (err ? reject(err) : resolve(reply)),
      ),
    )

  it('permits a valid run and denies a note, with a message for the client', async () => {
    expect((await admit(run())).decision).toBe(1)
    expect(await admit(sign({ kind: 1, content: 'gm' }))).toMatchObject({ decision: 2, message: "Silvamor's relay doesn't keep kind 1" })
  })

  it('reads fields protobuf leaves out at zero: a kind-0 profile is admitted', async () => {
    expect((await admit(sign({ kind: 0, content: '{}' }), '198.51.100.9')).decision).toBe(1)
  })

  it('answers the health check while running, and fails it when nothing is listening', async () => {
    expect(await checkHealth(`127.0.0.1:${guard.port}`)).toBe(true)
    expect(await checkHealth('127.0.0.1:1')).toBe(false)
  })

  it("passes on the sender's IP address: a third counted event from it this minute is refused", async () => {
    expect((await admit(sign({ kind: 3 }))).decision).toBe(1)
    expect(await admit(sign({ kind: 3 }))).toMatchObject({ decision: 2, message: 'too many events, slow down' })
  })
})
