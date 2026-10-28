// The seeded random generator Silvamor's daily games shuffle with (docs/PROTOCOL.md).

/**
 * sfc32, seeded from a 64-hex-character seed: the eight 32-bit words w0..w7 (big-endian)
 * become a = w0^w4, b = w1^w5, c = w2^w6, d = w3^w7, and the first 15 outputs are dropped.
 */
export function generator(seed: string): () => number {
  const w = Array.from({ length: 8 }, (_, i) => parseInt(seed.slice(i * 8, i * 8 + 8), 16) | 0)
  let a = w[0] ^ w[4]
  let b = w[1] ^ w[5]
  let c = w[2] ^ w[6]
  let d = w[3] ^ w[7]
  const next = () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
  for (let i = 0; i < 15; i++) next()
  return next
}
