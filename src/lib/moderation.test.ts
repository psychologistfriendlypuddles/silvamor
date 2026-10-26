import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { buildFeatured, buildSpriteReport, parseFeatured, parseSettings, reportersBySprite, spriteBlocked } from './moderation'
import { OSTRICH, type Sprite } from './sprites'

const keys = () => {
  const sk = generateSecretKey()
  return { sk, pk: getPublicKey(sk) }
}
const artist = keys()
const me = keys()
const sprite: Sprite = { ...OSTRICH, id: `30951:${artist.pk}:duck`, author: artist.pk, name: 'Duck' }
const friends = [keys(), keys(), keys()]
const stranger = keys()
const report = (k: { sk: Uint8Array }) => finalizeEvent(buildSpriteReport(sprite, 'nudity', ''), k.sk)

describe('sprite moderation', () => {
  const base = { me: me.pk, hidden: new Set<string>(), follows: new Set(friends.map((f) => f.pk)), blurReported: true }

  it('counts reporters per sprite', () => {
    const who = reportersBySprite([report(friends[0]), report(friends[0]), report(stranger)]).get(sprite.id)!
    expect([...who].sort()).toEqual([friends[0].pk, stranger.pk].sort())
  })

  it('three reports from people you follow blur a sprite; strangers do not count', () => {
    const two = reportersBySprite([report(friends[0]), report(friends[1]), report(stranger)]).get(sprite.id)
    expect(spriteBlocked(sprite, { ...base, reporters: two })).toBeNull()
    const three = reportersBySprite(friends.map(report)).get(sprite.id)
    expect(spriteBlocked(sprite, { ...base, reporters: three })).toBe('reported')
    expect(spriteBlocked(sprite, { ...base, reporters: three, blurReported: false })).toBeNull()
  })

  it('your own report hides it for you; hidden artists are hidden; your own sprites never', () => {
    expect(spriteBlocked(sprite, { ...base, reporters: new Set([me.pk]) })).toBe('reported')
    expect(spriteBlocked(sprite, { ...base, reporters: undefined, hidden: new Set([artist.pk]) })).toBe('hidden')
    expect(spriteBlocked(sprite, { ...base, me: artist.pk, reporters: new Set([artist.pk]), hidden: new Set([artist.pk]) })).toBeNull()
    expect(spriteBlocked(OSTRICH, { ...base, reporters: new Set([me.pk]) })).toBeNull()
  })

  it('reads settings defensively and featured lists round-trip', () => {
    expect(parseSettings('not json')).toEqual({ hiddenArtists: [], blurReported: true })
    expect(parseSettings(JSON.stringify({ hiddenArtists: [artist.pk, 'junk'], blurReported: false }))).toEqual({ hiddenArtists: [artist.pk], blurReported: false })
    expect(parseFeatured(finalizeEvent(buildFeatured([sprite.id]), me.sk))).toEqual([sprite.id])
  })
})
