import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { getToken } from 'nostr-tools/nip98'
import { startDevRelay, type DevRelay } from '../../scripts/dev-relay.mjs'
import { buildAction, buildListing, coordinateOf, parseListing, type ActionContent } from '../../src/lib/nostr/gameEvents'
import { buildChatMessage } from '../../src/lib/nostr/chat'
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
    getHeight: async () => 800_000,
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
  it("pushes your turn and chat, but not old news from before you subscribed", async () => {
    // A game already in progress: guest to move.
    const listingEvent = await publish(hostSk, buildListing({ id: 'push1', game: 'tictactoe', status: 'active', access: 'open', blocks: 3, pubkeys: [host, guest] }))
    const listing = parseListing(listingEvent)!
    const act = (sk: Uint8Array, content: ActionContent, prev: { id: string } | undefined) =>
      publish(sk, buildAction(listing, content, { prev: prev?.id, others: [], block: 800_000 }))
    const start = await act(hostSk, { type: 'start', n: 0, players: [host, guest] }, undefined)
    const hostMove = await act(hostSk, { type: 'move', n: 1, move: { cell: 4 } }, start)

    sent.length = 0
    expect((await call('POST', guestSk, { subscription: subscription(10) })).status).toBe(201)
    await new Promise((r) => setTimeout(r, 800))
    expect(sent).toEqual([]) // "your turn" already pending when they subscribed: not pushed

    const guestMove = await act(guestSk, { type: 'move', n: 2, move: { cell: 0 } }, hostMove)
    await act(hostSk, { type: 'move', n: 3, move: { cell: 8 } }, guestMove)
    await vi.waitFor(() => expect(sent.map((s) => s.payload.body)).toContain('🎯 Your turn in Tic-Tac-Toe'), { timeout: 5000 })
    const turn = sent.find((s) => s.payload.body.includes('Your turn'))!
    expect(turn.endpoint).toBe(subscription(10).endpoint)
    expect(turn.payload.url).toMatch(/^https:\/\/app\.example\/game\/naddr1/)
    expect(turn.payload.tag).toBe(coordinateOf(host, 'push1'))

    await publish(hostSk, buildChatMessage(listing, 'gl hf', [host, guest], host))
    await vi.waitFor(() => expect(sent.some((s) => /💬 .*: gl hf/.test(s.payload.body))).toBe(true), { timeout: 5000 })

    // Each notice goes out once.
    const count = sent.length
    await new Promise((r) => setTimeout(r, 800))
    expect(sent.length).toBe(count)
  })
})
