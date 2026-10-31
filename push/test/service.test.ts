import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import webpush from 'web-push'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { getToken } from 'nostr-tools/nip98'
import { startDevRelay, type DevRelay } from '../../scripts/dev-relay.mjs'
import { buildMinerRun } from '../../src/lib/nostr/minerRuns'
import { dayOf, dayStart, previousDay } from '../../src/games/day'
import { MAX_SUBSCRIPTIONS_PER_KEY, Store } from '../src/store'
import { createWatchtower, type PushPayload, type Watchtower } from '../src/watchtower'
import { startService, webPushSender } from '../src/server'

const RELAY_PORT = 7811
const SERVICE_PORT = 8811
const SILENT_PORT = 7812
const SERVICE = `http://localhost:${SERVICE_PORT}`
const keys = { p256dh: 'p', auth: 'a' }
const subscription = (n: number) => ({ endpoint: `https://push.example/sub/${n}`, keys })

let relay: DevRelay
let service: { close(): Promise<void> }
let store: Store
const sent: { endpoint: string; payload: PushPayload }[] = []

const day = dayOf(new Date())
const yesterday = previousDay(day)
const twoDaysAgo = previousDay(yesterday)
const block = { height: 900_000, hash: 'ab'.repeat(32), timestamp: dayStart(day) + 60 }
/** A run on `onDay` with this streak, as the app publishes it. */
const runEvent = (onDay: string, streak: number) => ({
  ...buildMinerRun({ day: onDay, block, moves: ['take'], score: 300, streak }),
  created_at: dayStart(onDay) + 3600,
})
/** The service's clock: by default 3 hours before today ends, in the reminder window. */
let clock = (dayStart(day) + 21 * 3600) * 1000
let watchtower: Watchtower

const hostSk = generateSecretKey()
const guestSk = generateSecretKey()
const guest = getPublicKey(guestSk)

async function publish(sk: Uint8Array, template: EventTemplate) {
  const event = finalizeEvent(template, sk)
  const r = await Relay.connect(relay.url)
  await r.publish(event)
  r.close()
  return event
}

/** NIP-98-signed request to the service, as the app makes it. */
async function call(method: 'POST' | 'DELETE', sk: Uint8Array | null, body: object) {
  const url = `${SERVICE}/subscriptions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sk) headers.Authorization = await getToken(url, method, (e) => finalizeEvent(e, sk), true, body)
  return fetch(url, { method, headers, body: JSON.stringify(body) })
}

/** A new key that played two days ago: it may sign up, and has no streak to keep today. */
async function player() {
  const sk = generateSecretKey()
  await publish(sk, runEvent(twoDaysAgo, 1))
  return sk
}

/** Leaves runs on the test relay unanswered for `ms` (0 ends it), as from a relay that's down. */
const holdRuns = (ms: number) => fetch(`http://localhost:${RELAY_PORT}/hold?kind=1953&ms=${ms}`, { method: 'POST' })

beforeAll(async () => {
  relay = await startDevRelay({ port: RELAY_PORT })
  await publish(guestSk, runEvent(twoDaysAgo, 1))
  store = new Store(':memory:')
  watchtower = createWatchtower({
    relays: [relay.url],
    store,
    send: async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload })
      return 'ok'
    },
    appUrl: 'https://app.example',
    every: 0,
    relayWaitMs: 2000,
    now: () => clock,
  })
  service = await startService(
    {
      port: SERVICE_PORT,
      publicUrl: SERVICE,
      appUrl: 'https://app.example',
      allowedOrigins: ['*'],
      relays: [relay.url],
      remindHoursBefore: 4,
      dataDir: mkdtempSync(join(tmpdir(), 'silvamor-push-')),
      vapidSubject: 'mailto:test@example.com',
      pushHosts: ['push.example'],
    },
    { store, watchtower, vapidPublicKey: 'test-vapid-key' },
  )
})

afterAll(async () => {
  await service.close()
  store.close()
  await relay.close()
})

describe('push service API', () => {
  it('hands out its VAPID public key', async () => {
    expect(await (await fetch(`${SERVICE}/vapid-public-key`)).text()).toBe('test-vapid-key')
  })

  it('refuses unsigned or badly signed subscriptions', async () => {
    expect((await call('POST', null, { subscription: subscription(1) })).status).toBe(401)
    // Signed for a different body than the one sent.
    const url = `${SERVICE}/subscriptions`
    const token = await getToken(url, 'POST', (e) => finalizeEvent(e, guestSk), true, { subscription: subscription(2) })
    const res = await fetch(url, { method: 'POST', headers: { Authorization: token }, body: JSON.stringify({ subscription: subscription(3) }) })
    expect(res.status).toBe(401)
  })

  it('subscribes with a NIP-98 signature; only the owner can unsubscribe', async () => {
    expect((await call('POST', guestSk, { subscription: subscription(9) })).status).toBe(201)
    expect(store.subscriptionsFor(guest).map((s) => s.endpoint)).toContain(subscription(9).endpoint)
    expect((await call('DELETE', hostSk, { endpoint: subscription(9).endpoint })).status).toBe(404)
    expect((await call('DELETE', guestSk, { endpoint: subscription(9).endpoint })).status).toBe(200)
    expect(store.subscriptionsFor(guest)).toEqual([])
    // With its last browser gone, nothing of the key is kept but the day's notices.
    expect(store.due('any', Date.now())).not.toContain(guest)
  })

  it('only signs up players with a game from the last 30 days', async () => {
    const refusal = "Reminders are for keeping a streak, so play today's block first, then turn them on."
    const sk = generateSecretKey()
    const res = await call('POST', sk, { subscription: subscription(40) })
    expect([res.status, (await res.json()).error]).toEqual([403, refusal])
    // A game from longer ago doesn't count: the relay lets runs go after 30 days.
    const awaySk = generateSecretKey()
    await publish(awaySk, runEvent(dayOf(new Date((dayStart(day) - 31 * 86400) * 1000)), 9))
    expect((await call('POST', awaySk, { subscription: subscription(41) })).status).toBe(403)
    expect(store.hasSubscription(subscription(41).endpoint)).toBe(false)
    // Once they've played, they're in.
    await publish(sk, runEvent(twoDaysAgo, 1))
    expect((await call('POST', sk, { subscription: subscription(40) })).status).toBe(201)
  })

  it("signs nobody up while the relay doesn't answer, and says so", async () => {
    const sk = await player()
    await holdRuns(10_000)
    try {
      const res = await call('POST', sk, { subscription: subscription(42) })
      expect([res.status, (await res.json()).error]).toEqual([503, "Couldn't reach the relay to check that you've played. Try again in a moment."])
    } finally {
      await holdRuns(0)
    }
    expect(store.hasSubscription(subscription(42).endpoint)).toBe(false)
  })

  it('tells a browser whether it is still signed up, with no signature needed', async () => {
    const check = (body: object) =>
      fetch(`${SERVICE}/subscriptions/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await call('POST', await player(), { subscription: subscription(43) })).status).toBe(201)
    expect(await (await check({ endpoint: subscription(43).endpoint })).json()).toEqual({ subscribed: true })
    expect(await (await check({ endpoint: subscription(44).endpoint })).json()).toEqual({ subscribed: false })
    expect((await check({})).status).toBe(400)
  })

  it('only takes subscriptions on a push service, so it never posts anywhere else', async () => {
    const sk = await player()
    const at = (endpoint: string) => call('POST', sk, { subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }).then((res) => res.status)
    for (const elsewhere of ['https://evil.example/x', 'https://push.example@evil.example/x', 'https://push.example.evil.example/x', 'https://push.example:8443/x', 'http://push.example/x']) {
      expect(await at(elsewhere), elsewhere).toBe(400)
    }
    expect(await at('https://eu.push.example/x')).toBe(201)
  })

  it("keeps a key's newest browsers, dropping the oldest", async () => {
    const sk = await player()
    for (let n = 0; n <= MAX_SUBSCRIPTIONS_PER_KEY; n++) expect((await call('POST', sk, { subscription: subscription(100 + n) })).status).toBe(201)
    const kept = store.subscriptionsFor(getPublicKey(sk)).map((s) => s.endpoint)
    expect(kept).toHaveLength(MAX_SUBSCRIPTIONS_PER_KEY)
    expect(kept).not.toContain(subscription(100).endpoint)
  })
})

describe('watchtower', () => {
  it('reminds players whose streak would end today, once, a few hours before the day ends', async () => {
    const keeperSk = generateSecretKey() // played yesterday, not yet today: reminded
    const doneSk = generateSecretKey() // played yesterday and today: not reminded
    const lapsedSk = generateSecretKey() // played two days ago: no streak to keep
    await publish(keeperSk, runEvent(yesterday, 12))
    await publish(doneSk, runEvent(yesterday, 3))
    await publish(doneSk, runEvent(day, 4))
    await publish(lapsedSk, runEvent(twoDaysAgo, 5))
    for (const [n, sk] of [keeperSk, doneSk, lapsedSk].entries()) expect((await call('POST', sk, { subscription: subscription(20 + n) })).status).toBe(201)

    // Too early in the day: nothing yet.
    sent.length = 0
    clock = (dayStart(day) + 12 * 3600) * 1000
    await watchtower.tick()
    expect(sent).toEqual([])

    clock = (dayStart(day) + 21 * 3600) * 1000
    await watchtower.tick()
    expect(sent).toEqual([
      {
        endpoint: subscription(20).endpoint,
        payload: { title: 'Silvamor', body: '🔥 Your 12-day streak ends in 3 hours. Play today to keep it going.', url: 'https://app.example/', tag: `streak:${day}` },
      },
    ])

    // Once a day.
    await watchtower.tick()
    expect(sent).toHaveLength(1)
  })

  it("doesn't let a push service that never answers hold up the other players", async () => {
    clock = (dayStart(day) + 21 * 3600) * 1000
    const own = new Store(':memory:')
    const [stuckSk, fineSk] = [generateSecretKey(), generateSecretKey()]
    await publish(stuckSk, runEvent(yesterday, 2))
    await publish(fineSk, runEvent(yesterday, 5))
    own.addSubscription(getPublicKey(stuckSk), { endpoint: 'https://push.example/stuck', keys: { p256dh: 'p', auth: 'a' } })
    own.addSubscription(getPublicKey(fineSk), { endpoint: 'https://push.example/fine', keys: { p256dh: 'p', auth: 'a' } })
    const lines: string[] = []
    let [inFlight, most] = [0, 0]
    const tower = createWatchtower({
      relays: [relay.url],
      store: own,
      send: async (sub) => {
        most = Math.max(most, ++inFlight)
        if (sub.endpoint.endsWith('/stuck')) return new Promise<never>(() => {})
        await new Promise((resolve) => setTimeout(resolve, 20))
        inFlight--
        return 'ok'
      },
      appUrl: 'https://app.example',
      every: 0,
      sendTimeoutMs: 50,
      now: () => clock,
      log: (m) => lines.push(m),
    })
    await tower.tick()
    tower.close()
    own.close()
    expect(lines.sort()).toEqual([
      'push error: 🔥 Your 2-day streak ends in 3 hours. Play today to keep it going.',
      'push ok: 🔥 Your 5-day streak ends in 3 hours. Play today to keep it going.',
    ])
    expect(most).toBe(2) // both players at once
  })

  it("isn't stopped by relays that can't be reached, whether they refuse or take the connection and never answer", async () => {
    clock = (dayStart(day) + 21 * 3600) * 1000
    const own = new Store(':memory:')
    const keeperSk = generateSecretKey()
    await publish(keeperSk, runEvent(yesterday, 7))
    own.addSubscription(getPublicKey(keeperSk), { endpoint: 'https://push.example/keeper', keys })
    // A relay that takes the connection and never answers, as one stuck behind its proxy.
    const held: Socket[] = []
    const silent = createServer((socket) => held.push(socket)).listen(SILENT_PORT)
    const lines: string[] = []
    const tower = createWatchtower({
      relays: [relay.url, 'ws://127.0.0.1:1', `ws://localhost:${SILENT_PORT}`],
      store: own,
      send: async () => 'ok',
      appUrl: 'https://app.example',
      every: 0,
      relayWaitMs: 1000,
      now: () => clock,
      log: (m) => lines.push(m),
    })
    // Neither may end the service: an error nothing handles ends a Node process (here, it fails the run).
    await tower.tick()
    // And either may hold a run from today, so the keeper isn't reminded yet, and is looked up again next round.
    expect(lines).toEqual([])
    expect(own.due(`streak:${day}`, clock - 1)).toEqual([getPublicKey(keeperSk)])
    tower.close()
    own.close()
    held.forEach((socket) => socket.destroy())
    silent.close()
  })

  it("looks each player up again 2 hours after the relay answered for them, or at the next round if it didn't", async () => {
    let at = (dayStart(day) + 20.5 * 3600) * 1000
    const later = (minutes: number) => (at += minutes * 60_000)
    const own = new Store(':memory:')
    const lines: string[] = []
    const tower = createWatchtower({
      relays: [relay.url],
      store: own,
      send: async () => 'ok',
      appUrl: 'https://app.example',
      every: 0,
      relayWaitMs: 1000,
      now: () => at,
      log: (m) => lines.push(m),
    })
    // Ann played two days ago: nothing to remind. A run from yesterday turning up after she was looked
    // up (the test relay takes it) shows when she's looked up again.
    const annSk = await player()
    own.addSubscription(getPublicKey(annSk), { endpoint: 'https://push.example/ann', keys })
    await tower.tick()
    await publish(annSk, runEvent(yesterday, 3))
    later(5)
    await tower.tick()
    expect(lines).toEqual([])
    later(115)
    await tower.tick()
    expect(lines).toEqual(['push ok: 🔥 Your 3-day streak ends in 2 hours. Play today to keep it going.'])

    // Ben has a streak, but the relay doesn't answer: he's looked up again at the next round, not in 2 hours.
    const benSk = generateSecretKey()
    await publish(benSk, runEvent(yesterday, 4))
    own.addSubscription(getPublicKey(benSk), { endpoint: 'https://push.example/ben', keys })
    lines.length = 0
    await holdRuns(10_000)
    try {
      await tower.tick()
    } finally {
      await holdRuns(0)
    }
    expect(lines).toEqual([])
    later(5)
    await tower.tick()
    expect(lines).toEqual(['push ok: 🔥 Your 4-day streak ends in 1 hour. Play today to keep it going.'])
    tower.close()
    own.close()
  })

  it('lets go of players with no game in 30 days, and of notices about days before yesterday', async () => {
    const own = new Store(':memory:')
    const keptSk = generateSecretKey()
    const [gone, kept] = [generateSecretKey(), keptSk].map(getPublicKey)
    own.addSubscription(gone, { endpoint: 'https://push.example/gone', keys })
    own.addSubscription(kept, { endpoint: 'https://push.example/kept', keys })
    // Twenty days on, in the reminder window, the watchtower sees `kept`'s game from the day before.
    let at = (dayStart(dayOf(new Date(Date.now() + 20 * 86400_000))) + 21 * 3600) * 1000
    await publish(keptSk, runEvent(previousDay(dayOf(new Date(at))), 2))
    const lines: string[] = []
    const tower = createWatchtower({ relays: [relay.url], store: own, send: async () => 'ok', appUrl: 'https://app.example', every: 0, now: () => at, log: (m) => lines.push(m) })
    await tower.tick()
    // Twenty-nine days after that: a month since `gone` signed up, but not since `kept` played.
    at += 29 * 86400_000
    const today = `streak:${dayOf(new Date(at))}`
    own.markSent(kept, ['streak:2026-01-01', today])
    await tower.tick()
    expect(own.hasSubscription('https://push.example/gone')).toBe(false)
    expect(own.hasSubscription('https://push.example/kept')).toBe(true)
    expect(lines).toEqual(['push ok: 🔥 Your 2-day streak ends in 3 hours. Play today to keep it going.', 'let go of 1 player with no game in 30 days'])
    expect([own.wasSent(kept, 'streak:2026-01-01'), own.wasSent(kept, today)]).toEqual([false, true])
    tower.close()
    own.close()
  })

  it('sends only to push services, also to subscriptions kept from before they were checked', async () => {
    const send = webPushSender(webpush.generateVAPIDKeys(), 'mailto:test@example.com', ['push.example'])
    const payload = { title: 'Silvamor', body: 'hi', url: 'https://app.example/', tag: 'test' }
    expect(await send({ endpoint: 'https://10.0.0.1/admin', keys: { p256dh: 'p', auth: 'a' } }, payload)).toBe('gone')
  })
})

describe('store', () => {
  it('gives keys that signed up before it kept players a fresh 30 days', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'silvamor-push-')), 'push.sqlite')
    // A store as the service kept it before.
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE subscriptions (endpoint TEXT PRIMARY KEY, pubkey TEXT NOT NULL, keys TEXT NOT NULL, created_at INTEGER NOT NULL)')
    old.prepare('INSERT INTO subscriptions VALUES (?, ?, ?, ?)').run('https://push.example/old', 'ab'.repeat(32), JSON.stringify(keys), Date.now() - 90 * 86400_000)
    old.close()
    const upgraded = new Store(path)
    expect(upgraded.forget(Date.now() - 30 * 86400_000, [])).toBe(0)
    expect(upgraded.due('streak:any', Date.now())).toEqual(['ab'.repeat(32)])
    upgraded.close()
  })
})
