import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { startDevRelay, type DevRelay } from './dev-relay.mjs'
import { collectStats } from './stats.mjs'

// Noon UTC today, so "an hour ago" is always today.
const now = Math.floor(Date.now() / 1000 / 86400) * 86400 + 12 * 3600
const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10)
let relay: DevRelay

/** A Daily Deal run (kind 1952) for the day `at` falls on. */
async function run(sk: Uint8Array, score: number, at = now - 3600) {
  const conn = await Relay.connect(relay.url)
  await conn.publish(
    finalizeEvent(
      { kind: 1952, created_at: at, content: '{"moves":[]}', tags: [['L', 'silvamor/dailydeal'], ['l', day(at), 'silvamor/dailydeal'], ['score', String(score)]] },
      sk,
    ),
  )
  conn.close()
}

describe('daily deal stats', () => {
  const alice = generateSecretKey()
  beforeAll(async () => {
    relay = await startDevRelay({ port: 7791 })
    await run(alice, 300, now - 7200)
    await run(alice, 900) // a second run the same day: only the first counts
    await run(generateSecretKey(), 500)
    await run(alice, 200, now - 2 * 86400)
  })
  afterAll(() => relay.close())

  it('counts each player once a day, with the top first-run score', async () => {
    const stats = await collectStats({ relays: [relay.url], days: 7, now, maxWait: 2000 })
    expect(stats.players).toBe(2)
    expect(stats.perDay).toHaveLength(7)
    expect(stats.perDay.at(-1)).toEqual({ day: day(now), players: 2, topScore: 500 })
    expect(stats.perDay.at(-3)).toEqual({ day: day(now - 2 * 86400), players: 1, topScore: 200 })
  })

  it('leaves out days before the window', async () => {
    const stats = await collectStats({ relays: [relay.url], days: 1, now, maxWait: 2000 })
    expect(stats.perDay).toEqual([{ day: day(now), players: 2, topScore: 500 }])
  })
})
