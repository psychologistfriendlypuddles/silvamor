import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { getToken } from 'nostr-tools/nip98'
import { startDevRelay, type DevRelay } from '../../scripts/dev-relay.mjs'
import { buildRun } from '../../src/lib/nostr/dailyRuns'
import { dailyDealRules, scorePlay, type DailyDealMove, type DailyDealState } from '../../src/games/dailydeal/rules'
import { dayOf, dayStart, seedFor } from '../../src/games/dailydeal/daily'
import { Store } from '../src/store'
import { createWatchtower, type PushPayload } from '../src/watchtower'
import { startService } from '../src/server'

const RELAY_PORT = 7811
const SERVICE_PORT = 8811
const SERVICE = `http://localhost:${SERVICE_PORT}`
const subscription = (n: number) => ({ endpoint: `https://push.example/sub/${n}`, keys: { p256dh: 'p', auth: 'a' } })

let relay: DevRelay
let service: { close(): Promise<void> }
let store: Store
const sent: { endpoint: string; payload: PushPayload }[] = []

const day = dayOf(new Date())
const block = { height: 900_000, hash: 'ab'.repeat(32), timestamp: dayStart(day) + 60 }

/** A whole run on today's deal, choosing each hand with `choose`. */
function runWith(choose: (s: DailyDealState) => number[]) {
  const rules = dailyDealRules(seedFor(day, block.hash))
  let state = rules.init()
  const moves: DailyDealMove[] = []
  while (!rules.outcome(state)) {
    const move = { play: choose(state) }
    state = rules.apply(state, move)
    moves.push(move)
  }
  return { moves, score: state.score }
}
const subsets = (cards: number[]): number[][] => cards.flatMap((c, i) => [[c], ...subsets(cards.slice(i + 1)).filter((s) => s.length < 5).map((s) => [c, ...s])])
const best = (s: DailyDealState) => subsets(s.hand).sort((a, b) => scorePlay(b, s.perks, s.handsLeft === 1).points - scorePlay(a, s.perks, s.handsLeft === 1).points)[0]
const weak = runWith((s) => [[...s.hand].sort((a, b) => (a % 13) - (b % 13))[0]])
const strong = runWith(best)
const runEvent = (run: typeof weak, beaten: string[]) => buildRun({ day, block, moves: run.moves, score: run.score, beaten })

const hostSk = generateSecretKey()
const guestSk = generateSecretKey()
const host = getPublicKey(hostSk)
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
  const watchtower = createWatchtower({
    relays: [relay.url],
    store,
    send: async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload })
      return 'ok'
    },
    findBlock: async () => block,
    appUrl: 'https://app.example',
  })
  service = await startService(
    {
      port: SERVICE_PORT,
      publicUrl: SERVICE,
      appUrl: 'https://app.example',
      allowedOrigins: ['*'],
      relays: [relay.url],
      blockSources: [relay.heightUrl],
      dataDir: mkdtempSync(join(tmpdir(), 'silvamor-push-')),
      vapidSubject: 'mailto:test@example.com',
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
})

describe('watchtower', () => {
  it("pushes a friend's first run that beats yours, once, and nothing else", async () => {
    const carolSk = generateSecretKey()
    const strangerSk = generateSecretKey()
    expect(weak.score).toBeLessThan(strong.score)
    // The guest follows the host and Carol, and played today, badly.
    await publish(guestSk, { kind: 3, created_at: Math.floor(Date.now() / 1000), tags: [['p', host], ['p', getPublicKey(carolSk)]], content: '' })
    await publish(guestSk, runEvent(weak, []))
    // The host beat them before they subscribed: old news.
    await publish(hostSk, runEvent(strong, [guest]))

    sent.length = 0
    expect((await call('POST', guestSk, { subscription: subscription(10) })).status).toBe(201)
    await new Promise((r) => setTimeout(r, 800))
    expect(sent).toEqual([])

    // A stranger, and the host's second run, don't count; Carol's first run does.
    await publish(strangerSk, runEvent(strong, [guest]))
    await publish(hostSk, { ...runEvent(strong, [guest]), created_at: Math.floor(Date.now() / 1000) + 1 })
    await publish(carolSk, runEvent(strong, [guest]))
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 5000 })
    expect(sent[0].endpoint).toBe(subscription(10).endpoint)
    expect(sent[0].payload).toMatchObject({ url: 'https://app.example/', tag: `dailydeal:${day}` })
    expect(sent[0].payload.body).toMatch(new RegExp(`^🃏 .+ beat your Daily Deal score with ${strong.score.toLocaleString('en-US')}$`))

    // Each notice goes out once.
    await new Promise((r) => setTimeout(r, 800))
    expect(sent).toHaveLength(1)
  })
})
