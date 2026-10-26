import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { startDevRelay, type DevRelay } from './dev-relay.mjs'
import { collectStats } from './stats.mjs'

// Noon UTC today, so "an hour ago" is always today.
const now = Math.floor(Date.now() / 1000 / 86400) * 86400 + 12 * 3600
let relay: DevRelay

async function publish(sk: Uint8Array, template: EventTemplate) {
  const event = finalizeEvent(template, sk)
  const conn = await Relay.connect(relay.url)
  await conn.publish(event)
  conn.close()
  return event
}

/** A game listing, optionally started (with a start action signed by `starter`, default the host). */
async function game(opts: { game: string; status: string; started?: boolean; at?: number; starter?: Uint8Array }) {
  const host = generateSecretKey()
  const d = Math.random().toString(16).slice(2, 18)
  const coordinate = `30950:${getPublicKey(host)}:${d}`
  const at = opts.at ?? now - 3600
  let startId: string | undefined
  if (opts.started) {
    const start = await publish(opts.starter ?? host, {
      kind: 1951,
      created_at: at,
      content: JSON.stringify({ type: 'start', n: 0, players: [getPublicKey(host), getPublicKey(generateSecretKey())] }),
      tags: [['a', coordinate]],
    })
    startId = start.id
  }
  await publish(host, {
    kind: 30950,
    created_at: at + 60,
    content: '{}',
    tags: [['d', d], ['t', 'silvamor'], ['game', opts.game], ['status', opts.status], ['access', 'open'], ...(startId ? [['e', startId]] : [])],
  })
}

describe('game stats', () => {
  beforeAll(async () => {
    relay = await startDevRelay({ port: 7791 })
    await game({ game: 'chess', status: 'finished', started: true })
    await game({ game: 'chess', status: 'active', started: true })
    await game({ game: 'go', status: 'finished', started: true, at: now - 2 * 86400 })
    await game({ game: 'reversi', status: 'open' }) // never started
    await game({ game: 'gomoku', status: 'active', started: true, starter: generateSecretKey() }) // start not by the host
    await game({ game: 'checkers', status: 'active' }) // claims to be active, no start
  })
  afterAll(() => relay.close())

  it('counts only games that really started, by game and by day', async () => {
    const stats = await collectStats({ relays: [relay.url], days: 7, now, maxWait: 2000 })
    expect(stats.total).toBe(3)
    expect(stats.finished).toBe(2)
    expect(stats.byGame).toEqual([
      { game: 'chess', name: 'Chess', games: 2 },
      { game: 'go', name: 'Go', games: 1 },
    ])
    expect(stats.perDay).toHaveLength(7)
    expect(stats.perDay.at(-1)!.games).toBe(2)
    expect(stats.perDay.at(-3)!.games).toBe(1)
  })

  it('leaves out games started before the window', async () => {
    const stats = await collectStats({ relays: [relay.url], days: 1, now, maxWait: 2000 })
    expect(stats.byGame).toEqual([{ game: 'chess', name: 'Chess', games: 2 }])
  })
})
