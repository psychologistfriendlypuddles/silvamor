// Drawing your block like mempool.space: a square whose area is the block's room. Each transaction
// is a tile whose area is exactly its share of the block's vbytes, and the room left is exactly the
// empty area. Tiles are rectangles kept as close to square as they can be (a "squarified treemap",
// Bruls, Huizing & van Wijk 2000), so they always fit; they move about as the block fills.

/** A rectangle in the block, as fractions of its side (0 to 1). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Tile extends Rect {
  /** Stream position of the transaction. */
  at: number
}

/** How far from square a row of areas laid along `side` would be: its worst width-to-height ratio. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((s, a) => s + a, 0)
  return Math.max(...row.map((a) => Math.max((side * side * a) / (sum * sum), (sum * sum) / (side * side * a))))
}

/** Lays out areas (summing to the rect's area) in order, in rows along the rect's shorter side. */
function squarify(areas: { key: number; area: number }[], rect: Rect): (Rect & { key: number })[] {
  const out: (Rect & { key: number })[] = []
  let { x, y, w, h } = rect
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row = [areas[i]]
    i++
    // Add to the row while that makes its tiles squarer.
    while (i < areas.length && worst([...row, areas[i]].map((r) => r.area), side) <= worst(row.map((r) => r.area), side)) row.push(areas[i++])
    const sum = row.reduce((s, r) => s + r.area, 0)
    if (w >= h) {
      // A column on the left, tiles stacked top to bottom.
      const width = h > 0 ? sum / h : 0
      let top = y
      for (const r of row) {
        const height = width > 0 ? r.area / width : 0
        out.push({ key: r.key, x, y: top, w: width, h: height })
        top += height
      }
      x += width
      w -= width
    } else {
      // A row along the top, tiles left to right.
      const height = w > 0 ? sum / w : 0
      let left = x
      for (const r of row) {
        const width = height > 0 ? r.area / height : 0
        out.push({ key: r.key, x: left, y, w: width, h: height })
        left += width
      }
      y += height
      h -= height
    }
  }
  return out
}

const EMPTY = -1

/**
 * The block's tiles for these transactions (stream position and vsize), largest first, and the
 * empty area left (null when the block is full). Areas are exact shares of `capacity`.
 */
export function layoutBlock(items: { at: number; vsize: number }[], capacity: number): { tiles: Tile[]; empty: Rect | null } {
  const used = items.reduce((s, t) => s + t.vsize, 0)
  const areas = [...items]
    .sort((a, b) => b.vsize - a.vsize || a.at - b.at)
    .map((t) => ({ key: t.at, area: t.vsize / capacity }))
  // The room left goes last, so it's one region at the end.
  if (used < capacity) areas.push({ key: EMPTY, area: (capacity - used) / capacity })
  const rects = squarify(areas, { x: 0, y: 0, w: 1, h: 1 })
  const empty = rects.find((r) => r.key === EMPTY)
  return {
    tiles: rects.filter((r) => r.key !== EMPTY).map(({ key, ...r }) => ({ at: key, ...r })),
    empty: empty ? { x: empty.x, y: empty.y, w: empty.w, h: empty.h } : null,
  }
}

/**
 * The room a transaction of `vsize` would take, drawn in the corner of the empty area: exactly its
 * area, as square as the empty area allows. Null if it doesn't fit.
 */
export function roomFor(empty: Rect | null, vsize: number, capacity: number): Rect | null {
  const area = vsize / capacity
  if (!empty || area > empty.w * empty.h + 1e-9) return null
  const w = Math.min(empty.w, Math.max(Math.sqrt(area), area / empty.h))
  return { x: empty.x, y: empty.y, w, h: area / w }
}
