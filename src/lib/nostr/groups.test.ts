import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { LocalKeySigner } from './signers'
import { buildGroup, buildGroupDeletion, parseGroup } from './groups'

const sk = generateSecretKey()
const me = getPublicKey(sk)
const signer = new LocalKeySigner(sk)
const encrypt = (t: string) => signer.nip44Encrypt(me, t)
const decrypt = (t: string) => signer.nip44Decrypt(me, t)
const friends = [getPublicKey(generateSecretKey()), getPublicKey(generateSecretKey())]

describe('groups (NIP-51 follow sets)', () => {
  it('round-trips a group with readable name and members', async () => {
    const event = finalizeEvent(buildGroup({ id: 'g1', title: 'Friday crew', members: friends }), sk)
    expect(event.tags).toContainEqual(['title', 'Friday crew'])
    expect(event.content).toBe('')
    expect(await parseGroup(event, decrypt)).toMatchObject({ id: 'g1', title: 'Friday crew', members: friends })
  })

  it('also reads NIP-51 private members that other apps added', async () => {
    const event = finalizeEvent(
      { kind: 30000, created_at: 1, tags: [['d', 'g2'], ['title', 'Mixed'], ['p', friends[0]]], content: await encrypt(JSON.stringify([['p', friends[1]]])) },
      sk,
    )
    expect((await parseGroup(event, decrypt))?.members).toEqual(friends)
  })

  it('skips deleted groups', async () => {
    const { tombstone } = buildGroupDeletion(me, 'g3')
    expect(await parseGroup(finalizeEvent(tombstone, sk), decrypt)).toBeNull()
  })
})
