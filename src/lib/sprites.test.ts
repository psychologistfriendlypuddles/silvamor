import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ANIMATIONS, OSTRICH, animationFor, buildSprite, buildSpriteChoice, parseManifest, parseSprite, parseSpriteChoice, sheetFits, sheetSize } from './sprites'

const minimal = { version: 1, size: 64, animations: { idle: { row: 0, frames: 2, fps: 4 } } }

describe('sprite manifests', () => {
  it('accepts the standard and the starter ostrich', () => {
    expect(parseManifest(JSON.stringify(minimal)).size).toBe(64)
    expect(parseManifest(OSTRICH.manifest)).toEqual(OSTRICH.manifest)
  })

  it('says what is wrong', () => {
    expect(() => parseManifest({ ...minimal, version: 2 })).toThrow(/version/)
    expect(() => parseManifest({ ...minimal, size: 8 })).toThrow(/size/)
    expect(() => parseManifest({ ...minimal, animations: { happy: { row: 0, frames: 1, fps: 1 } } })).toThrow(/idle/)
    expect(() => parseManifest({ ...minimal, animations: { idle: { row: 0, frames: 1, fps: 1 }, dance: { row: 1, frames: 1, fps: 1 } } })).toThrow(/Unknown/)
    expect(() => parseManifest({ ...minimal, animations: { idle: { row: 0, frames: 1, fps: 1 }, sad: { row: 0, frames: 1, fps: 1 } } })).toThrow(/share row/)
    expect(() => parseManifest({ ...minimal, animations: { idle: { row: 0, frames: 40, fps: 1 } } })).toThrow(/frames/)
    expect(() => parseManifest({ ...minimal, animations: { idle: { row: 11, frames: 1, fps: 1 } } })).toThrow(/row from 0 to 10/)
  })

  it('sizes the sheet from the longest row and the last row', () => {
    expect(sheetSize(OSTRICH.manifest)).toEqual({ width: 64 * 6, height: 64 * 11 })
  })

  it('takes a sheet from what its animations use up to 16 frames by 11 rows, and no bigger', () => {
    const m = parseManifest(minimal)
    expect(sheetFits(m, 128, 64)).toBe(true)
    expect(sheetFits(m, 1024, 704)).toBe(true)
    expect(sheetFits(m, 127, 64)).toBe(false)
    expect(sheetFits(m, 1025, 704)).toBe(false)
    expect(sheetFits(m, 1024, 705)).toBe(false)
    expect(sheetFits(m, 30_000, 30_000)).toBe(false)
  })

  it('the generated ostrich sheet matches its manifest, and the template suits 128px frames', () => {
    const size = (path: string) => {
      const png = readFileSync(new URL(path, import.meta.url))
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    }
    const ostrich = size('../../public/sprites/ostrich.png')
    expect(ostrich).toEqual(sheetSize(OSTRICH.manifest))
    expect(sheetFits(OSTRICH.manifest, ostrich.width, ostrich.height)).toBe(true)
    const template = size('../../public/sprites/template.png')
    const allRows = parseManifest({ version: 1, size: 128, animations: Object.fromEntries(ANIMATIONS.map((name, row) => [name, { row, frames: 4, fps: 4 }])) })
    expect(sheetFits(allRows, template.width, template.height)).toBe(true)
  })

  it('falls back for missing moods: win → happy → idle, lose → sad → idle', () => {
    const m = parseManifest({ ...minimal, animations: { idle: { row: 0, frames: 2, fps: 4 }, happy: { row: 1, frames: 3, fps: 8 } } })
    expect(animationFor(m, 'win')).toBe(m.animations.happy)
    expect(animationFor(m, 'lose')).toBe(m.animations.idle)
    expect(animationFor(m, 'idle')).toBe(m.animations.idle)
  })
})

describe('sprite events', () => {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)

  it('round-trips a published sprite', () => {
    const e = finalizeEvent(buildSprite({ d: 'duck', name: 'Disco duck', image: 'https://blossom.example/abc.png', sha256: 'ab'.repeat(32), manifest: OSTRICH.manifest }), sk)
    const s = parseSprite(e)!
    expect(s).toMatchObject({ id: `30951:${pk}:duck`, name: 'Disco duck', author: pk, image: 'https://blossom.example/abc.png' })
    expect(s.manifest).toEqual(OSTRICH.manifest)
  })

  it('refuses sheets that are not https and broken manifests', () => {
    const bad = (image: string, manifest: object) =>
      parseSprite(finalizeEvent({ ...buildSprite({ d: 'x', name: 'x', image, sha256: '', manifest: OSTRICH.manifest }), content: JSON.stringify(manifest) }, sk))
    expect(bad('http://evil.example/a.png', OSTRICH.manifest)).toBeNull()
    expect(bad('javascript:alert(1)', OSTRICH.manifest)).toBeNull()
    expect(bad('https://ok.example/a.png', { version: 1 })).toBeNull()
  })

  it('round-trips a player choice, built-in or published', () => {
    expect(parseSpriteChoice(finalizeEvent(buildSpriteChoice('builtin:ostrich'), sk))).toBe('builtin:ostrich')
    expect(parseSpriteChoice(finalizeEvent(buildSpriteChoice(`30951:${pk}:duck`), sk))).toBe(`30951:${pk}:duck`)
    expect(parseSpriteChoice(finalizeEvent(buildSpriteChoice('builtin:unicorn'), sk))).toBeNull()
  })
})

describe('sprites are free', () => {
  it('reads sprite events published with a price (from before tips) like any other', () => {
    const sk = generateSecretKey()
    const template = buildSprite({ d: 'duck', name: 'Duck', image: 'https://b.example/d.png', sha256: 'cd'.repeat(32), manifest: OSTRICH.manifest })
    const old = finalizeEvent({ ...template, tags: [...template.tags, ['price', '210']] }, sk)
    expect(parseSprite(old)).toMatchObject({ id: `30951:${getPublicKey(sk)}:duck`, name: 'Duck' })
    expect(parseSprite(old)).not.toHaveProperty('price')
  })
})
