// Draws the starter ostrich sprite sheet (public/sprites/ostrich.png) and a blank template
// for artists (public/sprites/template.png), following docs/SPRITES.md.
// Usage: node scripts/sprites/ostrich.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../public/sprites/', import.meta.url))
const S = 64 // frame size

// --- A tiny RGBA canvas ---

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]

class Canvas {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.px = new Uint8Array(w * h * 4)
  }
  set(x, y, c) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.px.set(c, (y * this.w + x) * 4)
  }
  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.px[(y * this.w + x) * 4 + 3]
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c)
  }
  ellipse(cx, cy, rx, ry, c, shade) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
        if (d <= 1) this.set(x, y, shade && y > cy + ry * 0.35 ? shade : c)
      }
  }
  poly(points, c) {
    const ys = points.map((p) => p[1])
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const cy = y + 0.5
      const xs = []
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i]
        const [x2, y2] = points[(i + 1) % points.length]
        if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xs.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1))
      }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) this.set(x, y, c)
    }
  }
  line(x1, y1, x2, y2, c, width = 1) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1) * 2
    for (let i = 0; i <= steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps
      const y = y1 + ((y2 - y1) * i) / steps
      this.rect(Math.round(x - (width - 1) / 2), Math.round(y - (width - 1) / 2), width, width, c)
    }
  }
  /** A 1px outline around everything drawn so far (cartoon style). */
  outline(c) {
    const edge = []
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.alpha(x, y) && (this.alpha(x - 1, y) || this.alpha(x + 1, y) || this.alpha(x, y - 1) || this.alpha(x, y + 1))) edge.push([x, y])
    for (const [x, y] of edge) this.set(x, y, c)
  }
  /** Draws `other` on top (alpha is all-or-nothing in pixel art). */
  over(other, ox = 0, oy = 0) {
    for (let y = 0; y < other.h; y++)
      for (let x = 0; x < other.w; x++) {
        const i = (y * other.w + x) * 4
        if (other.px[i + 3]) this.set(x + ox, y + oy, other.px.subarray(i, i + 4))
      }
  }
}

function png(canvas) {
  const raw = Buffer.alloc((canvas.w * 4 + 1) * canvas.h)
  for (let y = 0; y < canvas.h; y++) Buffer.from(canvas.px.buffer, y * canvas.w * 4, canvas.w * 4).copy(raw, y * (canvas.w * 4 + 1) + 1)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(canvas.w, 0)
  ihdr.writeUInt32BE(canvas.h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- A 3×5 pixel font for labels ---

const FONT = {
  A: '010101111101101', C: '011100100100011', D: '110101101101110', E: '111100110100111', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', K: '101101110101101', L: '100100100100111', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', W: '101101101111101', Y: '101101010010010', '+': '000010111010000', 1: '010110010010111',
  '!': '010010010000010', ' ': '000000000000000',
}
function text(canvas, str, x, y, c, scale = 1) {
  for (const ch of str) {
    const bits = FONT[ch] ?? FONT[' ']
    for (let i = 0; i < 15; i++) if (bits[i] === '1') canvas.rect(x + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, c)
    x += 4 * scale
  }
}

// --- The ostrich ---

const P = {
  outline: hex('#1b1530'),
  cap: hex('#e0574a'), capShade: hex('#b63f36'),
  cream: hex('#f3e6c8'), creamShade: hex('#d8c49d'),
  beak: hex('#f2a93b'), beakShade: hex('#cf8424'),
  eye: hex('#1b1530'), white: hex('#ffffff'),
  body: hex('#3d4050'), bodyShade: hex('#2b2d39'), wing: hex('#565a6b'), wingLight: hex('#70758a'),
  tail: hex('#ece7dc'), tailShade: hex('#bdb8ae'),
  leg: hex('#eaa53a'), legShade: hex('#c4832a'),
  base: hex('#ecc154'), baseTop: hex('#f6d77c'), rim: hex('#2f8f5b'),
  bolt: hex('#ffe14d'), boltCore: hex('#fffbe0'), tear: hex('#6ec6ff'), pink: hex('#ff7ab8'), mint: hex('#5eead4'),
  grape: hex('#8b5cf6'), smoke: hex('#9aa0ae'), red: hex('#ef4444'), blush: hex('#f59e9e'),
}

/**
 * One frame. `o` = pose:
 *   dy: whole bird up/down; hx, hy: head offset; eye: open|closed|happy|sad|x|wide|up;
 *   beak: closed|open; wing: down|up|half; puff: feathers puffed (shock); fx: [effects…]
 */
function ostrich(o = {}) {
  const { dy = 0, hx = 0, hy = 0, eye = 'open', beak = 'closed', wing = 'down', puff = false, blush = false } = o
  const base = new Canvas(S, S)
  base.ellipse(30, 59.5, 17, 3.5, P.rim)
  base.ellipse(30, 57.5, 17, 3.5, P.base)
  base.ellipse(30, 57, 15, 2.2, P.baseTop)
  base.outline(P.outline)

  const bird = new Canvas(S, S)
  const by = 36 + dy
  // Legs: hip → knee → foot; feet leave the base when jumping.
  const footY = Math.min(55, 55 + dy)
  for (const [x, shade] of [[26, true], [32, false]]) {
    const c = shade ? P.legShade : P.leg
    bird.line(x, by + 6, x + 1.5, (by + 6 + footY) / 2, c, 2)
    bird.line(x + 1.5, (by + 6 + footY) / 2, x, footY, c, 2)
    bird.line(x, footY, x + 4, footY, c, 1)
    bird.line(x, footY, x - 2, footY, c, 1)
  }
  // Tail tuft, body, wing.
  const r = puff ? 1.5 : 0
  bird.ellipse(16 - r, by - 5, 4 + r, 3 + r, P.tail, P.tailShade)
  bird.ellipse(13 - r, by - 8, 3 + r, 3 + r, P.tail)
  bird.ellipse(28, by, 12 + r, 8 + r, P.body, P.bodyShade)
  if (wing === 'up') {
    bird.poly([[21, by - 1], [33, by - 1], [18, by - 12]], P.wing)
    bird.poly([[23, by - 1], [30, by - 1], [20, by - 9]], P.wingLight)
  } else if (wing === 'half') {
    bird.poly([[20, by - 2], [34, by - 1], [16, by - 6]], P.wing)
  } else {
    bird.ellipse(27, by - 1, 8, 4.5, P.wing)
    bird.ellipse(25, by - 2, 4, 2, P.wingLight)
  }
  // Neck up to the (blocky) head.
  const hX = 39 + hx
  const hY = 8 + hy + dy
  bird.poly([[32.5, by - 4], [39.5, by - 5], [hX + 7, hY + 7], [hX + 1, hY + 7]], P.cream)
  bird.line(33, by - 5, hX + 1, hY + 7, P.creamShade, 1)
  bird.rect(hX, hY, 10, 8, P.cream)
  bird.rect(hX, hY + 6, 10, 2, P.creamShade)
  // Pyramid cap.
  bird.poly([[hX - 1, hY + 0.5], [hX + 11, hY + 0.5], [hX + 5, hY - 6]], P.cap)
  bird.poly([[hX - 1, hY + 0.5], [hX + 5, hY + 0.5], [hX + 5, hY - 6]], P.capShade)
  // Beak.
  if (beak === 'open') {
    bird.poly([[hX + 9, hY + 2], [hX + 16, hY + 3], [hX + 9, hY + 4]], P.beak)
    bird.poly([[hX + 9, hY + 6], [hX + 14, hY + 8], [hX + 9, hY + 7]], P.beakShade)
    bird.rect(hX + 9, hY + 4, 3, 2, P.outline)
  } else {
    bird.poly([[hX + 9, hY + 3], [hX + 16, hY + 4.5], [hX + 9, hY + 6]], P.beak)
    bird.poly([[hX + 9, hY + 4.5], [hX + 16, hY + 4.5], [hX + 9, hY + 6]], P.beakShade)
  }
  bird.outline(P.outline)
  // Eyes and cheeks go on after the outline so they stay crisp.
  const ex = hX + 6
  const ey = hY + 2
  if (blush) bird.rect(ex - 2, ey + 4, 2, 1, P.blush)
  const eyes = {
    open: () => (bird.rect(ex, ey, 2, 2, P.eye), bird.set(ex, ey, P.white)),
    up: () => (bird.rect(ex, ey - 1, 2, 2, P.eye), bird.set(ex + 1, ey - 1, P.white)),
    closed: () => bird.rect(ex - 1, ey + 1, 3, 1, P.eye),
    happy: () => (bird.set(ex - 1, ey + 1, P.eye), bird.set(ex, ey, P.eye), bird.set(ex + 1, ey + 1, P.eye)),
    sad: () => (bird.rect(ex, ey + 1, 2, 1, P.eye), bird.set(ex - 1, ey - 1, P.eye), bird.set(ex, ey - 1, P.eye)),
    x: () => [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]].forEach(([i, j]) => bird.set(ex + i, ey + j, P.eye)),
    wide: () => (bird.rect(ex - 1, ey - 1, 3, 3, P.eye), bird.set(ex - 1, ey - 1, P.white)),
  }
  eyes[eye]()

  const frame = new Canvas(S, S)
  frame.over(base)
  frame.over(bird)
  for (const fx of o.fx ?? []) fx(frame, { hX, hY, dy })
  return frame
}

// --- Effects (drawn over the bird) ---

const outlined = (draw) => (frame, ctx) => {
  const c = new Canvas(S, S)
  draw(c, ctx)
  c.outline(P.outline)
  frame.over(c)
}
const sparkle = (x, y, c, big = false) => (frame) => {
  frame.set(x, y, c)
  for (let i = 1; i <= (big ? 2 : 1); i++) [[i, 0], [-i, 0], [0, i], [0, -i]].forEach(([a, b]) => frame.set(x + a, y + b, c))
}
const thought = (dots) =>
  outlined((c) => {
    c.ellipse(34, 15, 1.2, 1.2, P.white)
    c.ellipse(30, 12, 1.8, 1.8, P.white)
    c.ellipse(20, 6, 9, 5, P.white)
    for (let i = 0; i < dots; i++) c.rect(15 + i * 4, 6, 2, 2, P.grape)
  })
const sweat = (t) => outlined((c, { hX, hY }) => c.poly([[hX - 2, hY + t], [hX - 0.5, hY + 3 + t], [hX - 3.5, hY + 3 + t]], P.tear))
const tear = (t) => outlined((c, { hX, hY }) => c.rect(hX + 6, hY + 4 + t, 1, 2, P.tear))
const bubble = (lines) =>
  outlined((c) => {
    c.rect(4, 1, 26, 13, P.white)
    c.poly([[24, 13], [30, 13], [31, 18]], P.white)
    for (let i = 0; i < lines; i++) c.rect(7, 4 + i * 3, i === lines - 1 ? 12 : 20, 1, P.grape)
  })
const label = (str, x, y, color) =>
  outlined((c) => text(c, str, x, y, color))
const alarm = (dy) =>
  outlined((c) => {
    c.rect(12, 2 + dy, 9, 11, P.white)
    text(c, '!', 15, 5 + dy, P.red)
  })
const bolt = (stage) =>
  outlined((c, { hX, hY }) => {
    // A zigzag coming in from the upper left; halfway there on the first frame.
    const pts = [[hX - 20, 0], [hX - 12, 0], [hX - 10, hY - 4], [hX - 5, hY - 5], [hX + 3, hY], [hX - 8, hY - 1], [hX - 11, hY + 3], [hX - 15, 0]]
    const k = stage === 0 ? 0.5 : 1
    c.poly(pts.map(([x, y]) => [hX - 20 + (x - hX + 20) * k, y * k]), P.bolt)
    if (stage) c.line(hX - 13, 1, hX - 9, hY - 2, P.boltCore, 1)
  })
const smoke = (t) =>
  outlined((c, { hX, hY }) => {
    c.ellipse(hX - 4 - t, hY + 1 - t, 2.5, 2, P.smoke)
    c.ellipse(hX - 9 - t, hY - 2 - t, 2, 1.6, P.smoke)
  })
const confetti = (seed) => (frame) => {
  const colors = [P.pink, P.mint, P.bolt, P.grape]
  for (let i = 0; i < 14; i++) {
    const x = (i * 37 + seed * 11) % 62
    const y = (i * 23 + seed * 9) % 30
    frame.rect(x, y, 2, 1 + ((i + seed) % 2), colors[i % 4])
  }
}
const flash = (frame) => {
  for (let i = 0; i < frame.w * frame.h; i++) {
    const p = frame.px
    if (p[i * 4 + 3]) for (let k = 0; k < 3; k++) p[i * 4 + k] = Math.min(255, p[i * 4 + k] + 120)
  }
}

// --- Animations: rows in the manifest's order (src/lib/sprites.ts OSTRICH) ---

const ROWS = [
  // idle: breathe and blink
  [{}, { dy: 1 }, { dy: 1 }, { eye: 'closed' }],
  // thinking: head tilted back, a thought bubble filling with dots
  [1, 2, 3, 3].map((dots) => ({ hx: -1, eye: 'up', fx: [thought(dots)] })),
  // happy: bouncing, beak open
  [
    { eye: 'happy', beak: 'open', blush: true },
    { dy: -2, eye: 'happy', wing: 'half', blush: true },
    { dy: -3, eye: 'happy', beak: 'open', wing: 'up', blush: true },
    { dy: -2, eye: 'happy', wing: 'half', blush: true },
  ],
  // sad: head lowered, a drop of sweat
  [0, 1, 2, 3].map((t) => ({ hy: 2, hx: -1, eye: 'sad', fx: [sweat(t)] })),
  // win: jumping and flapping in confetti
  [0, -4, -8, -8, -4, 0].map((dy, i) => ({
    dy,
    eye: 'happy',
    beak: i % 2 ? 'closed' : 'open',
    wing: i % 2 ? 'up' : 'half',
    blush: true,
    fx: [confetti(i), sparkle(8 + i * 3, 20 - i, P.bolt, i % 2 === 0), sparkle(56 - i * 2, 24, P.pink, i % 2 === 1)],
  })),
  // lose: head drooping, tears
  [0, 2, 4, 6].map((t, i) => ({ hy: 5, hx: -2, dy: i > 1 ? 1 : 0, eye: 'closed', fx: [tear(t)] })),
  // draw: a shrug
  [{ eye: 'open' }, { wing: 'half', hy: 1 }, { wing: 'up', hy: 1, eye: 'closed' }, { wing: 'half' }],
  // strike (one-shot): struck by lightning, then smoking
  [
    { eye: 'open', fx: [bolt(0)] },
    { eye: 'wide', puff: true, fx: [bolt(1)] },
    { eye: 'x', puff: true, fx: [bolt(1), flash] },
    { eye: 'x', puff: true, fx: [smoke(0)] },
    { eye: 'x', fx: [smoke(1)] },
    { eye: 'sad', fx: [smoke(2)] },
  ],
  // capture (one-shot): a peck, then +1
  [
    { hx: 1, hy: 1 },
    { hx: 4, hy: 6, eye: 'closed' },
    { hx: 4, hy: 7, eye: 'closed', beak: 'open' },
    { hx: 1, hy: 2, eye: 'happy', fx: [label('+1', 50, 2, P.bolt)] },
    { eye: 'happy', beak: 'open', fx: [label('+1', 50, 1, P.bolt), sparkle(48, 9, P.mint)] },
    { eye: 'happy', fx: [label('+1', 50, 0, P.bolt)] },
  ],
  // check (one-shot): alarmed hop with "!"
  [
    { eye: 'wide' },
    { dy: -3, eye: 'wide', wing: 'half', puff: true, fx: [alarm(2)] },
    { dy: -4, eye: 'wide', beak: 'open', wing: 'up', puff: true, fx: [alarm(0)] },
    { dy: -2, eye: 'wide', wing: 'half', fx: [alarm(0)] },
    { eye: 'wide', fx: [alarm(1)] },
    { eye: 'open', fx: [alarm(1)] },
  ],
  // chat (one-shot): talking with a speech bubble
  [1, 2, 3, 3].map((lines, i) => ({ beak: i % 2 ? 'closed' : 'open', fx: [bubble(lines)] })),
]

const cols = Math.max(...ROWS.map((r) => r.length))
const sheet = new Canvas(S * cols, S * ROWS.length)
ROWS.forEach((row, y) => row.forEach((pose, x) => sheet.over(ostrich(pose), x * S, y * S)))
mkdirSync(OUT, { recursive: true })
writeFileSync(OUT + 'ostrich.png', png(sheet))

// --- Template: an empty labelled grid at 128px, 8 frames wide ---

const T = 128
const NAMES = ['IDLE', 'THINKING', 'HAPPY', 'SAD', 'WIN', 'LOSE', 'DRAW', 'STRIKE', 'CAPTURE', 'CHECK', 'CHAT']
const template = new Canvas(T * 8, T * NAMES.length)
NAMES.forEach((name, row) => {
  for (let col = 0; col < 8; col++) {
    const x = col * T
    const y = row * T
    template.rect(x, y, T, T, hex((row + col) % 2 ? '#ece9f6' : '#f7f5fc'))
    template.rect(x, y + Math.round(T * 0.92), T, 1, hex('#f0a3c4')) // feet line
    template.rect(x + T / 2, y, 1, T, hex('#dcd6ee')) // centre line
  }
  text(template, name, 4, row * T + 4, hex('#8b5cf6'), 2)
})
writeFileSync(OUT + 'template.png', png(template))
console.log(`wrote ${OUT}ostrich.png (${sheet.w}×${sheet.h}) and template.png`)
