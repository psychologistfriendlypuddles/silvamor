import { describe, expect, it } from 'vitest'
import { layoutBlock, roomFor, type Rect } from './blockLayout'

const area = (r: Rect) => r.w * r.h
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9
const inside = (r: Rect, box: Rect = { x: 0, y: 0, w: 1, h: 1 }) =>
  r.x >= box.x - 1e-9 && r.y >= box.y - 1e-9 && r.x + r.w <= box.x + box.w + 1e-9 && r.y + r.h <= box.y + box.h + 1e-9

describe('drawing your block', () => {
  const sizes = [400, 120, 900, 150, 300, 110, 600, 200, 140, 140, 140]
  const items = sizes.map((vsize, at) => ({ at, vsize }))
  const capacity = 3400
  const { tiles, empty } = layoutBlock(items, capacity)

  it("gives every transaction exactly its share of the block's area, and the room left exactly the rest", () => {
    for (const t of tiles) expect(area(t)).toBeCloseTo(sizes[t.at] / capacity, 9)
    expect(area(empty!)).toBeCloseTo((capacity - sizes.reduce((s, v) => s + v, 0)) / capacity, 9)
  })

  it('fits every tile in the block without overlapping, largest first', () => {
    const all = [...tiles, empty!]
    for (const r of all) expect(inside(r)).toBe(true)
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j])).toBe(false)
    expect(tiles[0].at).toBe(2) // the 900 vB one
  })

  it('keeps tiles near square', () => {
    const worst = Math.max(...tiles.map((t) => Math.max(t.w / t.h, t.h / t.w)))
    expect(worst).toBeLessThan(4)
  })

  it("shows the room a transaction would take in the empty area, exactly its size, or none if it doesn't fit", () => {
    const room = roomFor(empty, 150, capacity)!
    expect(area(room)).toBeCloseTo(150 / capacity, 9)
    expect(inside(room, empty!)).toBe(true)
    expect(roomFor(empty, 201, capacity)).toBeNull()
    expect(layoutBlock([{ at: 0, vsize: 1000 }], 1000).empty).toBeNull()
  })
})
