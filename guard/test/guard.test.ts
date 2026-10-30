import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import protobuf from 'protobufjs'
import { hexToBytes } from 'nostr-tools/utils'
import { finalizeEvent, generateSecretKey, getPublicKey, type Event, type EventTemplate } from 'nostr-tools/pure'
import { buildMinerRun } from '../../src/lib/nostr/minerRuns'
import { NOTHING_KEPT } from '../../src/lib/nostr/vanish'
import type { MinerDeal } from '../../src/games/miner/rules'
import { dayOf, dayStart, previousDay } from '../../src/games/day'
import { createPolicy, type Policy } from '../src/policy'
import { erase, parseRetention, prune, pruneNonPlayers, storedStreaks, sweepRuns, vanishRequests } from '../src/cleanup'
import { CheckedRuns } from '../src/checked'
import { checkHealth, checkedRunsPath, configFromEnv, startGuard, streaksFrom } from '../src/server'
import nauthzProto from '../proto/nauthz.proto?raw'

const HOME = 'wss://relay.silvamor.com'
const day = dayOf(new Date())
const block = { height: 900_000, hash: 'ab'.repeat(32), timestamp: dayStart(day) + 60 }
const sk = generateSecretKey()
const sign = (t: Partial<EventTemplate> & { kind: number }) => finalizeEvent({ created_at: Math.floor(Date.now() / 1000), tags: [], content: '', ...t }, sk)

/** nostr-rs-relay's event and tag tables (schema version 18). */
const RELAY_SCHEMA = `
  PRAGMA foreign_keys = ON; PRAGMA user_version = 18;
  CREATE TABLE event (id INTEGER PRIMARY KEY, event_hash BLOB NOT NULL, first_seen INTEGER NOT NULL, created_at INTEGER NOT NULL,
    expires_at INTEGER, author BLOB NOT NULL, delegated_by BLOB, kind INTEGER NOT NULL, hidden INTEGER, content TEXT NOT NULL);
  CREATE TABLE tag (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, name TEXT, value TEXT, value_hex BLOB, created_at INTEGER NOT NULL,
    kind INTEGER NOT NULL, FOREIGN KEY(event_id) REFERENCES event(id) ON UPDATE CASCADE ON DELETE CASCADE);
`

/** Today's deal: three transactions, the block found after all three, room for 300 vB. */
const deal: MinerDeal = {
  stream: [
    { txid: 'a'.repeat(64), fee: 300, vsize: 100 },
    { txid: 'b'.repeat(64), fee: 100, vsize: 200 },
    { txid: 'c'.repeat(64), fee: 900, vsize: 100, parent: 1 },
  ],
  capacity: 300,
  foundAt: 3,
}

/** A finished run on today's deal: the cheap parent and its rich child, 1,000 sats. */
function run(scoreOffset = 0, streak = 1) {
  return finalizeEvent(buildMinerRun({ day, block, moves: ['pass', 'take', 'take'], score: 1000 + scoreOffset, streak }), sk)
}

describe('admission policy', () => {
  const policy = () => createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9 })

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

  it("admits runs that replay on the day's deal to their fees, and no others; Daily Deal runs no longer", async () => {
    const p = policy()
    expect((await p.decide(run())).permit).toBe(true)
    expect(await p.decide(run(1))).toEqual({ permit: false, message: "the run doesn't replay to its fees" })
    expect((await p.decide(sign({ kind: 1953, content: 'junk' }))).permit).toBe(false)
    expect(await p.decide(sign({ kind: 1952, content: '{}' }))).toEqual({ permit: false, message: "Silvamor's relay doesn't keep kind 1952" })
  })

  it("refuses runs it can't check yet: a day whose block isn't mined, or no block source answering", async () => {
    const tryAgain = { permit: false, later: true, message: `can't check runs for ${day} yet, try again in a minute` }
    const unmined = createPolicy({ relayUrl: HOME, findBlock: async () => null, findDeal: async () => deal, perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9 })
    expect(await unmined.decide(run())).toEqual(tryAgain)
    const down = createPolicy({ relayUrl: HOME, findBlock: async () => Promise.reject(new Error('offline')), findDeal: async () => deal, perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9 })
    expect(await down.decide(run())).toEqual(tryAgain)
  })

  it("doesn't limit a key, so resending a player's events can't lock them out", async () => {
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 3, perIpDay: 100_000, perIpDayBytes: 1e9 })
    const profile = sign({ kind: 0, content: '{}' })
    // Someone sends the player's profile again and again, from one address and then from many.
    for (let i = 0; i < 10; i++) await p.decide(profile, { ip: '203.0.113.66' })
    for (let i = 0; i < 100; i++) expect((await p.decide(profile, { ip: `198.51.100.${i}` })).permit).toBe(true)
    // The player's own run still gets in.
    expect(await p.decide(run(), { ip: '192.0.2.1' })).toEqual({ permit: true })
  })
})

describe('limits per IP address', () => {
  /** A profile from a brand-new key each time: the throwaway-keys attack. */
  const throwaway = () => finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: '{}' }, generateSecretKey())

  it('caps one address per minute, however many keys it uses', async () => {
    let t = 0
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 3, perIpDay: 100, perIpDayBytes: 1e9, now: () => t })
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
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 100, perIpDay: 5, perIpDayBytes: 1e9, now: () => t })
    for (let i = 0; i < 5; i++) {
      t += 120_000
      expect((await p.decide(throwaway(), { ip: '203.0.113.7' })).permit).toBe(true)
    }
    t += 120_000
    expect(await p.decide(throwaway(), { ip: '203.0.113.7' })).toEqual({ permit: false, message: 'too many events from your network today, try again tomorrow' })
    t += 24 * 3600_000
    expect((await p.decide(throwaway(), { ip: '203.0.113.7' })).permit).toBe(true)
  })

  it('caps the data one address can have kept a day (20 MB by default), but never its runs or requests to vanish', async () => {
    expect(configFromEnv({}).perIpDayBytes).toBe(20 * 1024 * 1024)
    let t = Date.now()
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 100, perIpDay: 100, perIpDayBytes: 3000, now: () => t })
    /** A profile of about 1 KB, from a brand-new key. */
    const profile = () => finalizeEvent({ kind: 0, created_at: Math.floor(t / 1000), tags: [], content: JSON.stringify({ about: 'x'.repeat(800) }) }, generateSecretKey())
    const ip = '203.0.113.7'
    expect((await p.decide(profile(), { ip })).permit).toBe(true)
    expect((await p.decide(profile(), { ip })).permit).toBe(true)
    expect(await p.decide(profile(), { ip })).toEqual({ permit: false, message: 'too much data from your network today, try again tomorrow' })
    // Runs and requests to vanish still get in, and other addresses aren't affected.
    expect(await p.decide(run(), { ip })).toEqual({ permit: true })
    expect(await p.decide(sign({ kind: 62, tags: [['relay', HOME]] }), { ip })).toEqual({ permit: true })
    expect((await p.decide(profile(), { ip: '198.51.100.2' })).permit).toBe(true)
    // A new day, a new budget.
    t += 24 * 3600_000
    expect((await p.decide(profile(), { ip })).permit).toBe(true)
  })
})

describe('cleanup', () => {
  /** A database with nostr-rs-relay's event and tag tables (schema version 18). */
  function relayDb() {
    const path = join(mkdtempSync(join(tmpdir(), 'silvamor-guard-')), 'nostr.db')
    const db = new DatabaseSync(path)
    db.exec(RELAY_SCHEMA)
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
      { kind: 1953, days: 30 },
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

  it("deletes the profiles, follow lists and relay lists of keys with no runs, and nothing of players'", () => {
    const path = join(mkdtempSync(join(tmpdir(), 'silvamor-guard-')), 'nostr.db')
    const db = new DatabaseSync(path)
    db.exec(RELAY_SCHEMA)
    const add = db.prepare("INSERT INTO event (event_hash, first_seen, created_at, author, kind, content) VALUES (?, 0, 0, ?, ?, '{}')")
    const [player, visitor] = [new Uint8Array([1]), new Uint8Array([2])]
    const rows: [Uint8Array, number][] = [
      [player, 1953],
      [player, 0],
      [player, 3],
      [player, 10002],
      [visitor, 0],
      [visitor, 3],
      [visitor, 10002],
      [visitor, 30000], // a league
      [visitor, 30951], // a sprite
    ]
    rows.forEach(([author, kind], i) => add.run(new Uint8Array([i + 1]), author, kind))
    db.close()
    expect(pruneNonPlayers(path, { dryRun: true })).toBe(3)
    expect(count(path, 'SELECT COUNT(*) AS n FROM event')).toBe(9)
    expect(pruneNonPlayers(path, { dryRun: false })).toBe(3)
    expect(count(path, "SELECT COUNT(*) AS n FROM event WHERE author = x'01'")).toBe(4)
    expect(count(path, "SELECT COUNT(*) AS n FROM event WHERE author = x'02' AND kind IN (30000, 30951)")).toBe(2)
    expect(count(path, 'SELECT COUNT(*) AS n FROM event')).toBe(6)
  })
})

describe('gRPC event admission', () => {
  let guard: Awaited<ReturnType<typeof startGuard>>
  let client: grpc.Client & { EventAdmit: (req: unknown, cb: (err: Error | null, reply: { decision: number; message?: string }) => void) => void }

  beforeAll(async () => {
    guard = await startGuard(
      { listen: '127.0.0.1:0', relayUrl: HOME, blockSources: [], perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, relayDb: null, retention: [], dryRun: true },
      { policy: createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 2, perIpDay: 100_000, perIpDayBytes: 1e9 }), log: () => {} },
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
  const admit = (e: Event, ip = '203.0.113.7', via = client) =>
    new Promise<{ decision: number; message?: string }>((resolve, reject) =>
      via.EventAdmit(
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

  it('refuses runs and requests to vanish when something goes wrong, and lets other events in', async () => {
    const broken = await startGuard(
      { listen: '127.0.0.1:0', relayUrl: HOME, blockSources: [], perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, relayDb: null, retention: [], dryRun: true },
      {
        policy: {
          decide: () => Promise.reject(new Error('bug')),
          recheck: () => Promise.reject(new Error('bug')),
          stillStands: () => {
            throw new Error('bug')
          },
        },
        log: () => {},
      },
    )
    const def = protoLoader.fromJSON(protobuf.parse(nauthzProto, { keepCase: true }).root.toJSON(), { keepCase: true, longs: Number, enums: Number, defaults: true })
    const { Authorization } = grpc.loadPackageDefinition(def).nauthz as unknown as { Authorization: grpc.ServiceClientConstructor }
    const via = new Authorization(`127.0.0.1:${broken.port}`, grpc.credentials.createInsecure()) as unknown as typeof client
    try {
      expect(await admit(run(), undefined, via)).toMatchObject({ decision: 2, message: 'something went wrong here, try again' })
      expect((await admit(sign({ kind: 62, tags: [['relay', HOME]] }), undefined, via)).decision).toBe(2)
      expect((await admit(sign({ kind: 3 }), undefined, via)).decision).toBe(1)
    } finally {
      via.close()
      await broken.close()
    }
  })
})

describe('requests to vanish (NIP-62)', () => {
  const me = getPublicKey(sk)
  const other = 'b'.repeat(64)
  const now = Math.floor(Date.now() / 1000)

  /** A relay database holding a profile, a run and a report from `me`, and a profile from someone else. */
  function storedDb() {
    const path = join(mkdtempSync(join(tmpdir(), 'silvamor-guard-')), 'nostr.db')
    const db = new DatabaseSync(path)
    db.exec(RELAY_SCHEMA)
    const add = db.prepare('INSERT INTO event (event_hash, first_seen, created_at, author, kind, content) VALUES (?, 0, ?, ?, ?, \'{}\')')
    const tag = db.prepare("INSERT INTO tag (event_id, name, value, created_at, kind) VALUES (?, 'p', 'x', ?, ?)")
    const rows: [string, number][] = [
      [me, 0],
      [me, 1952],
      [me, 1984],
      [other, 0],
    ]
    rows.forEach(([author, kind], i) => {
      const id = Number(add.run(new Uint8Array([i + 1]), now - 3600, hexToBytes(author), kind).lastInsertRowid)
      tag.run(id, now - 3600, kind)
    })
    db.close()
    return path
  }
  const authors = (path: string) => {
    const db = new DatabaseSync(path)
    const rows = db.prepare('SELECT lower(hex(author)) AS a, kind FROM event ORDER BY id').all() as { a: string; kind: number }[]
    const tags = (db.prepare('SELECT COUNT(*) AS n FROM tag').get() as { n: number }).n
    db.close()
    return { events: rows.map((r) => `${r.a === me ? 'me' : 'other'}:${r.kind}`), tags }
  }

  it('admits requests that name this relay or all relays, and refuses ones for other relays', async () => {
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9 })
    expect(await p.decide(sign({ kind: 62, tags: [['relay', `${HOME}/`]] }))).toEqual({ permit: true })
    expect(await p.decide(sign({ kind: 62, tags: [['relay', 'ALL_RELAYS']] }))).toEqual({ permit: true })
    expect(await p.decide(sign({ kind: 62, tags: [['relay', 'wss://nos.lol']] }))).toEqual({ permit: false, message: `a request to vanish here names ${HOME}` })
  })

  it("refuses a vanished key's older events, and admits newer ones", async () => {
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, vanishedAt: (pk) => (pk === me ? now : undefined) })
    expect(await p.decide(sign({ kind: 0, content: '{}', created_at: now - 60 }))).toEqual({ permit: false, message: 'this key asked this relay to delete its events' })
    expect(await p.decide(sign({ kind: 0, content: '{}', created_at: now + 60 }))).toEqual({ permit: true })
  })

  it("deletes everything the key published, with its tags, and nobody else's", () => {
    const path = storedDb()
    expect(erase(path, me, now)).toEqual({ deleted: 3, runs: [] })
    expect(authors(path)).toEqual({ events: ['other:0'], tags: 1 })
    expect(vanishRequests(path)).toEqual(new Map())
    // The relay then stores the request itself, which is how the guard remembers it after a restart.
    const db = new DatabaseSync(path)
    db.prepare("INSERT INTO event (event_hash, first_seen, created_at, author, kind, content) VALUES (x'09', 0, ?, ?, 62, '')").run(now, hexToBytes(me))
    db.close()
    expect(vanishRequests(path)).toEqual(new Map([[me, now]]))
    expect(erase(path, me, now + 10)).toEqual({ deleted: 0, runs: [] })
  })

  it('carries out a request the relay kept while the guard was away, within a sweep of its return', async () => {
    const path = storedDb()
    // Stored without asking the guard (it was restarting, say): nothing of the key's was deleted.
    const db = new DatabaseSync(path)
    db.prepare("INSERT INTO event (event_hash, first_seen, created_at, author, kind, content) VALUES (x'0a', ?, ?, ?, 62, '')").run(now, now, hexToBytes(me))
    db.close()
    const lines: string[] = []
    const guard = await startGuard(
      { listen: '127.0.0.1:0', relayUrl: HOME, blockSources: [], perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, relayDb: path, retention: [], dryRun: true },
      { log: (m) => lines.push(m) },
    )
    try {
      await guard.sweep()
      expect(authors(path).events).toEqual(['other:0', 'me:62'])
      expect(lines).toContain('request to vanish, kept while the guard was away: deleted 3 events')
      // Done once is done: the next sweep finds nothing more to delete.
      await guard.sweep()
      expect(lines.filter((l) => l.startsWith('request to vanish'))).toHaveLength(1)
    } finally {
      await guard.close()
    }
  })

  describe('through the relay', () => {
    let guard: Awaited<ReturnType<typeof startGuard>>
    let path: string
    let client: grpc.Client & { EventAdmit: (req: unknown, cb: (err: Error | null, reply: { decision: number; message?: string }) => void) => void }

    beforeAll(async () => {
      path = storedDb()
      guard = await startGuard(
        { listen: '127.0.0.1:0', relayUrl: HOME, blockSources: [], perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, relayDb: path, retention: [], dryRun: true },
        { log: () => {} },
      )
      const def = protoLoader.fromJSON(protobuf.parse(nauthzProto, { keepCase: true }).root.toJSON(), { keepCase: true, longs: Number, enums: Number, defaults: true })
      const { Authorization } = grpc.loadPackageDefinition(def).nauthz as unknown as { Authorization: grpc.ServiceClientConstructor }
      client = new Authorization(`127.0.0.1:${guard.port}`, grpc.credentials.createInsecure()) as unknown as typeof client
    })
    afterAll(async () => {
      client.close()
      await guard.close()
    })
    const admit = (e: Event) =>
      new Promise<{ decision: number; message?: string }>((resolve, reject) =>
        client.EventAdmit(
          { event: { id: hexToBytes(e.id), pubkey: hexToBytes(e.pubkey), created_at: e.created_at, kind: e.kind, content: e.content, tags: e.tags.map((values) => ({ values })), sig: hexToBytes(e.sig) } },
          (err, reply) => (err ? reject(err) : resolve(reply)),
        ),
      )

    it('deletes the key\'s events, lets the request in, and keeps refusing what it deleted, even in a dry run', async () => {
      expect((await admit(sign({ kind: 62, tags: [['relay', HOME]] }))).decision).toBe(1)
      expect(authors(path).events).toEqual(['other:0'])
      expect(await admit(sign({ kind: 0, content: '{}', created_at: now - 60 }))).toMatchObject({ decision: 2, message: 'this key asked this relay to delete its events' })
    })

    it('refuses a request from a key with nothing kept here, without remembering it; a key that vanished may ask again', async () => {
      const stranger = generateSecretKey()
      expect(await admit(finalizeEvent({ kind: 62, created_at: now, tags: [['relay', HOME]], content: '' }, stranger))).toMatchObject({ decision: 2, message: NOTHING_KEPT })
      expect((await admit(finalizeEvent({ kind: 0, created_at: now - 60, tags: [], content: '{}' }, stranger))).decision).toBe(1)
      // The key from the test before has nothing left, but it's remembered.
      expect((await admit(sign({ kind: 62, tags: [['relay', HOME]] }))).decision).toBe(1)
    })

    it('refuses a request when it has no database to delete from', async () => {
      const bare = await startGuard(
        { listen: '127.0.0.1:0', relayUrl: HOME, blockSources: [], perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, relayDb: null, retention: [], dryRun: true },
        { log: () => {} },
      )
      await guard.close()
      guard = bare
      const def = protoLoader.fromJSON(protobuf.parse(nauthzProto, { keepCase: true }).root.toJSON(), { keepCase: true, longs: Number, enums: Number, defaults: true })
      const { Authorization } = grpc.loadPackageDefinition(def).nauthz as unknown as { Authorization: grpc.ServiceClientConstructor }
      client.close()
      client = new Authorization(`127.0.0.1:${bare.port}`, grpc.credentials.createInsecure()) as unknown as typeof client
      expect((await admit(sign({ kind: 62, tags: [['relay', HOME]] }))).decision).toBe(2)
    })
  })
})

describe('streaks', () => {
  const me = getPublicKey(sk)
  const yesterday = previousDay(day)

  it("admits a streak only when the day before's run here claims one day less", async () => {
    const asked: string[] = []
    const p = createPolicy({
      relayUrl: HOME,
      findBlock: async () => block,
      findDeal: async () => deal,
      perIpMinute: 1000,
      perIpDay: 100_000,
      perIpDayBytes: 1e9,
      streaksOn: (pk, d) => (asked.push(d), pk === me && d === yesterday ? [3] : []),
    })
    expect(await p.decide(run(0, 4))).toEqual({ permit: true })
    expect(await p.decide(run(0, 1))).toEqual({ permit: true })
    expect(await p.decide(run(0, 6))).toEqual({ permit: false, message: 'a 6-day streak needs a 5-day streak the day before' })
    expect(asked.every((d) => d === yesterday)).toBe(true)
  })

  it("doesn't check streaks it can't look up", async () => {
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, streaksOn: () => null })
    expect(await p.decide(run(0, 9))).toEqual({ permit: true })
  })

  it("reads the streaks of a player's stored runs for a day, counting runs without one as a first day", () => {
    const path = join(mkdtempSync(join(tmpdir(), 'silvamor-guard-')), 'nostr.db')
    const db = new DatabaseSync(path)
    db.exec(RELAY_SCHEMA)
    const add = db.prepare('INSERT INTO event (event_hash, first_seen, created_at, author, kind, content) VALUES (?, 0, 0, ?, 1953, ?)')
    const label = db.prepare("INSERT INTO tag (event_id, name, value, created_at, kind) VALUES (?, 'l', ?, 0, 1953)")
    const stored: [string, string, string[][]][] = [
      [me, yesterday, [['l', yesterday, 'silvamor/miner'], ['streak', '3']]],
      [me, yesterday, [['l', yesterday, 'silvamor/miner']]],
      [me, day, [['l', day, 'silvamor/miner'], ['streak', '4']]],
      ['b'.repeat(64), yesterday, [['l', yesterday, 'silvamor/miner'], ['streak', '7']]],
    ]
    stored.forEach(([author, d, tags], i) => {
      // nostr-rs-relay keeps the whole event as JSON in `content`.
      const id = Number(add.run(new Uint8Array([i + 1]), hexToBytes(author), JSON.stringify({ kind: 1953, pubkey: author, tags, content: '{}' })).lastInsertRowid)
      label.run(id, d)
    })
    db.close()
    expect(storedStreaks(path, me, yesterday)?.sort()).toEqual([1, 3])
    expect(storedStreaks(path, me, '2000-01-01')).toEqual([])
  })
})

describe('Block of the Day runs', () => {
  const tryAgain = { permit: false, later: true, message: `can't check runs for ${day} yet, try again in a minute` }
  const stale ={ permit: false, message: "this run wasn't made just now (is your clock right?)" }
  const noon = dayStart(day) + 12 * 3600
  const twoDaysAgo = previousDay(previousDay(day))
  /** The policy with its clock at `seconds` (unix). */
  const policyAt = (seconds: number) =>
    createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: async () => deal, perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, now: () => seconds * 1000 })
  /** `run()` made at `at` (unix seconds), for `onDay`. */
  const runAt = (at: number, onDay = day) => finalizeEvent({ ...buildMinerRun({ day: onDay, block, moves: ['pass', 'take', 'take'], score: 1000, streak: 1 }), created_at: at }, sk)

  it("takes runs only as they're made, on their day, so a past day can't be played later", async () => {
    const p = policyAt(noon)
    expect(await p.decide(runAt(noon))).toEqual({ permit: true })
    expect(await p.decide(runAt(noon - 2 * 3600))).toEqual(stale)
    // A past day, played now or dated back to it.
    expect(await p.decide(runAt(noon, twoDaysAgo))).toEqual({ permit: false, message: `a run for ${twoDaysAgo} has to be made that day` })
    expect(await p.decide(runAt(dayStart(twoDaysAgo) + 3600, twoDaysAgo))).toEqual(stale)
    // A date that doesn't exist is no day at all.
    expect(await p.decide(runAt(noon, '2026-02-31'))).toEqual({ permit: false, message: 'not a Block of the Day run' })
  })

  it("takes the day before's runs until 02:00 UTC", async () => {
    const yesterday = previousDay(day)
    const late = dayStart(day) + 600
    expect(await policyAt(late).decide(runAt(late, yesterday))).toEqual({ permit: true })
    expect(await policyAt(late + 2 * 3600).decide(runAt(late + 2 * 3600, yesterday))).toEqual({ permit: false, message: `a run for ${yesterday} has to be made that day` })
  })

  it("refuses runs while the day's transactions can't be read", async () => {
    const p = createPolicy({ relayUrl: HOME, findBlock: async () => block, findDeal: () => Promise.reject(new Error('offline')), perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9 })
    expect(await p.decide(run())).toEqual(tryAgain)
  })

  it('reads a day once at a time, keeps a run waiting a moment at most, and waits after the sources had nothing', async () => {
    let t = Date.now()
    let asked = 0
    let answer: (found: typeof block | null) => void = () => {}
    const p = createPolicy({
      relayUrl: HOME,
      findBlock: () => (asked++, new Promise<typeof block | null>((resolve) => (answer = resolve))),
      findDeal: async () => deal,
      perIpMinute: 1000,
      perIpDay: 100_000,
      perIpDayBytes: 1e9,
      lookupMs: 20,
      now: () => t,
    })
    expect(await p.decide(run())).toEqual(tryAgain) // the sources are slow: refused for now
    expect(await p.decide(run())).toEqual(tryAgain) // still reading: not asked again
    answer(null) // not mined yet
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await p.decide(run())).toEqual(tryAgain) // just had nothing: not asked again yet
    expect(asked).toBe(1)
    t += 15_000
    const later = p.decide(run())
    answer(block)
    expect(await later).toEqual({ permit: true })
    expect(await p.decide(run())).toEqual({ permit: true })
    expect(asked).toBe(2)
  })
})

describe('sweep', () => {
  const otherSk = generateSecretKey()
  const yesterday = previousDay(day)
  const twoDaysAgo = previousDay(yesterday)
  const [d2, y, t] = [dayStart(twoDaysAgo), dayStart(yesterday), dayStart(day)]

  /** A run on `onDay` made at `at` (unix seconds), played as `run()` plays it unless `score` says otherwise. */
  const made = (who: Uint8Array, onDay: string, at: number, { streak = 1, score = 1000 } = {}) =>
    finalizeEvent({ ...buildMinerRun({ day: onDay, block, moves: ['pass', 'take', 'take'], score, streak }), created_at: at }, who)

  function relayDb() {
    const path = join(mkdtempSync(join(tmpdir(), 'silvamor-guard-')), 'nostr.db')
    const db = new DatabaseSync(path)
    db.exec(RELAY_SCHEMA)
    db.close()
    return path
  }
  /** Stores `event` as nostr-rs-relay does when it gets it at `at`: its JSON, and its single-letter tags. Returns its id. */
  function store(path: string, event: Event, at: number) {
    const db = new DatabaseSync(path)
    const add = db.prepare('INSERT INTO event (event_hash, first_seen, created_at, author, kind, content) VALUES (?, ?, ?, ?, ?, ?)')
    const id = Number(add.run(hexToBytes(event.id), at, event.created_at, hexToBytes(event.pubkey), event.kind, JSON.stringify(event)).lastInsertRowid)
    const tag = db.prepare('INSERT INTO tag (event_id, name, value, created_at, kind) VALUES (?, ?, ?, ?, ?)')
    for (const [name, value] of event.tags) if (name.length === 1) tag.run(id, name, value, event.created_at, event.kind)
    db.close()
    return event.id
  }
  const stored = (path: string) => {
    const db = new DatabaseSync(path)
    const ids = db.prepare('SELECT lower(hex(event_hash)) AS id FROM event').all() as { id: string }[]
    db.close()
    return new Set(ids.map((r) => r.id))
  }
  /** The guard's policy over the relay database at `path`, which keeps runs 30 days; the deal two days ago can't be read. */
  const policyOver = (path: string) =>
    createPolicy({
      relayUrl: HOME,
      findBlock: async () => block,
      findDeal: async (d) => (d === twoDaysAgo ? Promise.reject(new Error('offline')) : deal),
      perIpMinute: 1000,
      perIpDay: 100_000,
      perIpDayBytes: 1e9,
      streaksOn: streaksFrom({ relayDb: path, retention: [{ kind: 1953, days: 30 }] }),
    })

  it("keeps a long streak whose oldest runs clean-up has deleted: links are only checked against days kept whole", async () => {
    const path = relayDb()
    const daysAgo = (n: number) => dayOf(new Date((t - n * 86400) * 1000))
    // A player on a 60-day streak: the run 30 days ago, which the oldest kept run extends, is gone.
    const kept = [29, 28].map((n) => store(path, made(sk, daysAgo(n), dayStart(daysAgo(n)) + 3600, { streak: 60 - n + 1 }), dayStart(daysAgo(n)) + 3605))
    const swept = await sweepRuns(path, 0, policyOver(path).recheck, { dryRun: false })
    expect(swept.failed).toEqual(new Map())
    expect(stored(path)).toEqual(new Set(kept))
  })

  it('deletes stored runs the guard would have refused, as each reached the relay, and the streaks they held up', async () => {
    const path = relayDb()
    const kept = [
      store(path, made(sk, yesterday, y + 3600), y + 3605), // sent as made
      store(path, made(sk, day, t + 600, { streak: 2 }), t + 605), // extends it
      store(path, made(sk, twoDaysAgo, d2 + 3600), d2 + 3605), // its day can't be read yet
    ]
    store(path, made(sk, yesterday, y + 7200), t + 700) // sent a day late
    store(path, made(sk, twoDaysAgo, t + 800), t + 800) // a past day, played today
    store(path, made(sk, day, t + 900, { score: 999 }), t + 905) // doesn't replay to its fees
    store(path, made(otherSk, yesterday, y + 3600), t + 1000) // sent a day late...
    store(path, made(otherSk, day, t + 1100, { streak: 2 }), t + 1105) // ...and the streak it held up
    const p = policyOver(path)

    // A dry run deletes nothing, so it can't see a streak that a deletion would break.
    const dry = await sweepRuns(path, 0, p.recheck, { dryRun: true })
    expect({ checked: dry.checked, failed: [...dry.failed.values()].reduce((a, b) => a + b), later: dry.later }).toEqual({ checked: 8, failed: 4, later: 1 })
    expect(stored(path).size).toBe(8)

    const swept = await sweepRuns(path, 0, p.recheck, { dryRun: false })
    expect(swept.failed).toEqual(
      new Map([
        ["this run wasn't made just now (is your clock right?)", 2],
        [`a run for ${twoDaysAgo} has to be made that day`, 1],
        ["the run doesn't replay to its fees", 1],
        ['a 2-day streak needs a 1-day streak the day before', 1],
      ]),
    )
    expect(swept.later).toBe(1)
    expect(stored(path)).toEqual(new Set(kept))
  })

  it('sweeps every stored run a minute after the guard starts, then the last two hours', async () => {
    const path = relayDb()
    const now = Math.floor(Date.now() / 1000)
    /** A run for two days ago, made and sent at `at`: never on its day. */
    const late = (at: number) => store(path, made(sk, twoDaysAgo, at), at)
    const lines: string[] = []
    const guard = await startGuard(
      { listen: '127.0.0.1:0', relayUrl: HOME, blockSources: [], perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, relayDb: path, retention: [], dryRun: false },
      { policy: policyOver(path), log: (m) => lines.push(m) },
    )
    try {
      late(now - 3 * 86400)
      await guard.sweep()
      const missed = late(now - 3 * 3600)
      late(now)
      await guard.sweep()
      expect(stored(path)).toEqual(new Set([missed]))
      expect(lines).toEqual(Array(2).fill(`sweep: 1 run checked, 1 failed (1× a run for ${twoDaysAgo} has to be made that day)`))
    } finally {
      await guard.close()
    }
  })

  // A sweep never deletes a run that was valid when it arrived, whatever has changed since.
  describe('runs it has found valid', () => {
    /** Today's deal as an update might read it: every fee a sat higher, so no run made before replays to its fees. */
    const newRules = { ...deal, stream: deal.stream.map((tx) => ({ ...tx, fee: tx.fee + 1 })) }

    /** Remembers `runs` as found valid by an earlier guard over `path`: as it took them, say. */
    function took(path: string, ...runs: Event[]) {
      const record = new CheckedRuns(checkedRunsPath(path))
      for (const r of runs) record.add(r.id, r.created_at)
      record.close()
    }
    /** Whether the guard over `path` remembers each of `runs`. */
    function remembers(path: string, ...runs: Event[]) {
      const record = new CheckedRuns(checkedRunsPath(path))
      try {
        return runs.map((r) => record.has(r.id))
      } finally {
        record.close()
      }
    }
    /** Asks the guard listening on `port` about `e`, as nostr-rs-relay does: 1 is yes, 2 no. */
    async function ask(port: number, e: Event) {
      const def = protoLoader.fromJSON(protobuf.parse(nauthzProto, { keepCase: true }).root.toJSON(), { keepCase: true, longs: Number, enums: Number, defaults: true })
      const { Authorization } = grpc.loadPackageDefinition(def).nauthz as unknown as { Authorization: grpc.ServiceClientConstructor }
      const client = new Authorization(`127.0.0.1:${port}`, grpc.credentials.createInsecure()) as unknown as grpc.Client & {
        EventAdmit: (req: unknown, cb: (err: Error | null, reply: { decision: number }) => void) => void
      }
      const event = { id: hexToBytes(e.id), pubkey: hexToBytes(e.pubkey), created_at: e.created_at, kind: e.kind, content: e.content, tags: e.tags.map((values) => ({ values })), sig: hexToBytes(e.sig) }
      try {
        return await new Promise<number>((resolve, reject) => client.EventAdmit({ event }, (err, reply) => (err ? reject(err) : resolve(reply.decision))))
      } finally {
        client.close()
      }
    }
    /** A guard over the relay database at `path` that deletes for real; with `policy`, or else its own. */
    const guardOver = (path: string, lines: string[], policy?: Policy) =>
      startGuard(
        { listen: '127.0.0.1:0', relayUrl: HOME, blockSources: [], perIpMinute: 1000, perIpDay: 100_000, perIpDayBytes: 1e9, relayDb: path, retention: [{ kind: 1953, days: 30 }], dryRun: false },
        { policy, log: (m) => lines.push(m) },
      )
    /** The policy over `path` after an update that reads the day's block or deal differently. */
    const updated = (path: string, change: { block?: typeof block; deal?: MinerDeal }) =>
      createPolicy({
        relayUrl: HOME,
        findBlock: async () => change.block ?? block,
        findDeal: async () => change.deal ?? deal,
        perIpMinute: 1000,
        perIpDay: 100_000,
        perIpDayBytes: 1e9,
        streaksOn: streaksFrom({ relayDb: path, retention: [{ kind: 1953, days: 30 }] }),
      })

    it.each([
      { change: 'the rules change', deal: newRules },
      { change: "the day's block changes (a reorg)", block: { ...block, hash: 'cd'.repeat(32) } },
    ])("doesn't judge them again when $change: only runs stored without asking it", async ({ deal: newDeal, block: newBlock }) => {
      const path = relayDb()
      const mine = made(sk, day, t + 600) // taken before the update
      store(path, mine, t + 605)
      took(path, mine)
      store(path, made(otherSk, day, t + 900), t + 905) // stored while the guard was away, for the update
      const lines: string[] = []
      const guard = await guardOver(path, lines, updated(path, { deal: newDeal, block: newBlock }))
      try {
        await guard.sweep()
        expect(stored(path)).toEqual(new Set([mine.id]))
        expect(lines).toEqual(["sweep: 2 runs checked, 1 failed (1× the run doesn't replay to its fees)"])
      } finally {
        await guard.close()
      }
    })

    it('remembers a run it takes, so a restart after the rules change keeps it', async () => {
      const path = relayDb()
      const mine = made(sk, day, Math.floor(Date.now() / 1000))
      const before = await guardOver(path, [], updated(path, {}))
      try {
        expect(await ask(before.port, mine)).toBe(1)
      } finally {
        await before.close()
      }
      store(path, mine, mine.created_at) // as the relay does, having heard yes
      const lines: string[] = []
      const after = await guardOver(path, lines, updated(path, { deal: newRules }))
      try {
        await after.sweep()
        expect(stored(path)).toEqual(new Set([mine.id]))
        expect(lines).toEqual(['sweep: 1 run checked, 0 failed'])
      } finally {
        await after.close()
      }
    })

    it('deletes one whose streak rested on a run the sweep deletes', async () => {
      const path = relayDb()
      store(path, made(sk, yesterday, y + 7200), t + 700) // stored while the guard was away, a day late
      const next = made(sk, day, t + 800, { streak: 2 }) // taken while that run was there
      const first = made(otherSk, day, t + 900) // taken: a first day, resting on nothing
      store(path, next, t + 805)
      store(path, first, t + 905)
      took(path, next, first)
      const lines: string[] = []
      const guard = await guardOver(path, lines, policyOver(path))
      try {
        await guard.sweep()
        expect(stored(path)).toEqual(new Set([first.id]))
        expect(lines).toEqual([
          "sweep: 3 runs checked, 2 failed (1× this run wasn't made just now (is your clock right?); 1× a 2-day streak needs a 1-day streak the day before)",
        ])
      } finally {
        await guard.close()
      }
    })

    it('deletes one that comes back after its key asked to vanish', async () => {
      const path = relayDb()
      const now = Math.floor(Date.now() / 1000)
      const gone = made(sk, yesterday, y + 3600)
      took(path, gone)
      // Three hours ago: further back than the sweeps after the first look.
      store(path, finalizeEvent({ kind: 62, created_at: now - 3 * 3600, tags: [['relay', HOME]], content: '' }, sk), now - 3 * 3600)
      const lines: string[] = []
      const guard = await guardOver(path, lines)
      try {
        await guard.sweep()
        store(path, gone, now) // uploaded again while the relay wasn't asking the guard
        await guard.sweep()
        expect(stored(path).has(gone.id)).toBe(false)
        expect(lines.at(-1)).toBe('sweep: 1 run checked, 1 failed (1× this key asked this relay to delete its events)')
      } finally {
        await guard.close()
      }
    })

    it('forgets them once they are deleted: by clean-up, or because their key asked to vanish', async () => {
      const path = relayDb()
      const now = Math.floor(Date.now() / 1000)
      const thirdSk = generateSecretKey()
      const vanish = (who: Uint8Array) => finalizeEvent({ kind: 62, created_at: now, tags: [['relay', HOME]], content: '' }, who)
      const old = made(otherSk, dayOf(new Date((now - 31 * 86400) * 1000)), now - 31 * 86400) // clean-up has deleted it
      const gone = made(sk, yesterday, y + 3600) // its key asks while the guard is away
      const asked = made(thirdSk, yesterday, y + 3600) // its key asks through the relay
      const kept = made(otherSk, day, t + 600)
      store(path, gone, y + 3605)
      store(path, asked, y + 3605)
      store(path, kept, t + 605)
      store(path, vanish(sk), now)
      took(path, old, gone, asked, kept)
      const guard = await guardOver(path, [])
      try {
        expect(await ask(guard.port, vanish(thirdSk))).toBe(1)
        await guard.sweep() // carries out the request kept while it was away
        guard.cleanup()
        expect(remembers(path, old, gone, asked, kept)).toEqual([false, false, false, true])
      } finally {
        await guard.close()
      }
    })

    it("judges every run in full when it can't open its record, and says so", async () => {
      const path = relayDb()
      mkdirSync(checkedRunsPath(path)) // a folder where the file should be
      store(path, made(sk, twoDaysAgo, t + 800), t + 800) // a past day, played today
      const lines: string[] = []
      const guard = await guardOver(path, lines, policyOver(path))
      try {
        await guard.sweep()
        expect(stored(path).size).toBe(0)
        expect(lines[0]).toMatch(/^couldn't open .*silvamor-guard\.db, so every sweep judges every run in full: /)
      } finally {
        await guard.close()
      }
    })
  })
})
