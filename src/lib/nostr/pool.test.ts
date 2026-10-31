import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { startDevRelay, type DevRelay } from '../../../scripts/dev-relay.mjs'
import { pool, queryOrFail } from './pool'

// A relay that doesn't answer mustn't look like one that has nothing: boards would show nobody
// playing, and a run would claim a first day and end its player's streak.
const RELAY_PORT = 7821
const SILENT_PORT = 7822

let relay: DevRelay
let silent: WebSocketServer

beforeAll(async () => {
  relay = await startDevRelay({ port: RELAY_PORT })
  // Takes connections, then never says a word: a relay that's stuck, or far too slow.
  silent = new WebSocketServer({ port: SILENT_PORT })
  await new Promise((resolve) => silent.once('listening', resolve))
})

afterAll(async () => {
  pool.destroy()
  for (const client of silent.clients) client.terminate()
  await new Promise((resolve) => silent.close(resolve))
  await relay.close()
})

describe('queryOrFail', () => {
  it('gives what a relay has, and nothing when it answers that it has nothing', async () => {
    const note = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'gm' }, generateSecretKey())
    const r = await Relay.connect(relay.url)
    await r.publish(note)
    r.close()
    expect((await queryOrFail(relay.url, { ids: [note.id] })).map((e) => e.id)).toEqual([note.id])
    expect(await queryOrFail(relay.url, { ids: ['f'.repeat(64)] })).toEqual([])
  })

  it("fails when the relay doesn't answer in time", async () => {
    await expect(queryOrFail(`ws://localhost:${SILENT_PORT}`, { kinds: [1953] }, 300)).rejects.toThrow(`ws://localhost:${SILENT_PORT} didn't answer`)
  })
})
