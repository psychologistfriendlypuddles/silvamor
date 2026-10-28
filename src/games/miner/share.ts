// Sharing a finished run as a public note (kind 1) on the player's own relays.

/**
 * The game's hashtag: shared notes carry it (as text and a `t` tag), and the Social page's feed
 * reads notes with it. It follows the game's name, so change it when the game is renamed.
 */
export const GAME_TAG = 'blockoftheday'

/** "12,345 sats" */
export const sats = (n: number) => `${n.toLocaleString('en-US')} sats`

/** Sats in short, to 3 significant digits: "1 sat", "999 sats", "15.3k sats", "105k sats", "1.5m sats". */
export function shortSats(n: number): string {
  if (n < 1000) return `${n} sat${n === 1 ? '' : 's'}`
  let value = n
  let unit = 0
  const units = ['', 'k', 'm', 'b']
  // Step up while rounding to 3 digits would still need 4 (999,950 is "1m", not "1000k").
  while (unit < units.length - 1 && Number(value.toPrecision(3)) >= 1000) {
    value /= 1000
    unit++
  }
  return `${Number(value.toPrecision(3))}${units[unit]} sats`
}

/** How a block compares with the miner's, in short sats: "15.3k sats ahead of the miner". */
export function versusMiner(fees: number, miner: number): string {
  if (fees === miner) return 'level with the miner'
  return `${shortSats(Math.abs(fees - miner))} ${fees > miner ? 'ahead of' : 'behind'} the miner`
}

/** The note offered after a run, for the player to edit before posting: the gap to the miner, not the score. */
export function shareText(day: string, height: number, fees: number, miner: number, streak: number, url: string): string {
  return [
    `⛏️ Block of the Day ${day}, block ${height.toLocaleString('en-US')}: ${versusMiner(fees, miner)}`,
    ...(streak > 1 ? [`🔥 ${streak}-day streak`] : []),
    fees > miner ? 'I beat the miner! Can you?' : fees === miner ? 'I tied with the miner. Can you beat it?' : 'The miner got me today. Can you beat it?',
    `${url} #${GAME_TAG}`,
  ].join('\n')
}
