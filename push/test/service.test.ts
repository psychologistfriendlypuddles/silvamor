import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
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
const SERVICE = `http://localhost:${SERVICE_PORT}`
const subscription = (n: number) => ({ endpoint: `https://push.example/sub/${n}`, keys: { p256dh: 'p', auth: 'a' } })

let relay: DevRelay
let service: { close(): Promise<void> }
let store: Store
const sent: { endpoint: string; payload: PushPayload }[] = []

const day = dayOf(new Date())
const yesterday = previousDay(day)
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

beforeAll(async () => {
  relay = await startDevRelay({ port: RELAY_PORT })
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
  })

  it('only takes subscriptions on a push service, so it never posts anywhere else', async () => {
    const sk = generateSecretKey()
    const at = (endpoint: string) => call('POST', sk, { subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } }).then((res) => res.status)
    for (const elsewhere of ['https://evil.example/x', 'https://push.example@evil.example/x', 'https://push.example.evil.example/x', 'https://push.example:8443/x', 'http://push.example/x']) {
      expect(await at(elsewhere), elsewhere).toBe(400)
    }
    expect(await at('https://eu.push.example/x')).toBe(201)
  })

  it("keeps a key's newest browsers, dropping the oldest", async () => {
    const sk = generateSecretKey()
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
    const newSk = generateSecretKey() // never played: no streak to keep
    await publish(keeperSk, runEvent(yesterday, 12))
    await publish(doneSk, runEvent(yesterday, 3))
    await publish(doneSk, runEvent(day, 4))
    for (const [n, sk] of [keeperSk, doneSk, newSk].entries()) expect((await call('POST', sk, { subscription: subscription(20 + n) })).status).toBe(201)

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

  it('sends only to push services, also to subscriptions kept from before they were checked', async () => {
    const send = webPushSender(webpush.generateVAPIDKeys(), 'mailto:test@example.com', ['push.example'])
    const payload = { title: 'Silvamor', body: 'hi', url: 'https://app.example/', tag: 'test' }
    expect(await send({ endpoint: 'https://10.0.0.1/admin', keys: { p256dh: 'p', auth: 'a' } }, payload)).toBe('gone')
  })
})
