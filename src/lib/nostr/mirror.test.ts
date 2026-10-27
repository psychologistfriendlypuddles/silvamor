import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { toMirror } from './mirror'

const sk = generateSecretKey()
const event = (kind: number, created_at: number) => finalizeEvent({ kind, created_at, tags: [], content: '' }, sk)

describe('mirroring to the home relay', () => {
  it('copies the newest profile, follow list and relay list the home relay lacks', () => {
    const oldFollows = event(3, 100)
    const follows = event(3, 200)
    const profile = event(0, 150)
    const relays = event(10002, 120)
    const note = event(1, 300)
    const missing = toMirror([oldFollows, follows, profile, relays, note], [event(0, 150), event(10002, 90)])
    expect(missing.map((e) => e.id).sort()).toEqual([follows.id, relays.id].sort())
  })

  it('copies nothing the home relay already has, or has newer', () => {
    expect(toMirror([event(3, 100)], [event(3, 100)])).toEqual([])
    expect(toMirror([event(3, 100)], [event(3, 500)])).toEqual([])
  })
})
