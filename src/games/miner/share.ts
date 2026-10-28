// Sharing a finished run as a public note (kind 1) on the player's own relays.

/**
 * The game's hashtag: shared notes carry it (as text and a `t` tag), and the Social page's feed
 * reads notes with it. It follows the game's name, so change it when the game is renamed.
 */
export const GAME_TAG = 'beattheminer'

/** "12,345 sats" */
export const sats = (n: number) => `${n.toLocaleString('en-US')} sats`

/** The note offered after a run, for the player to edit before posting. */
export function shareText(day: string, height: number, fees: number, ofMiner: number, streak: number, url: string): string {
  return [
    `⛏️ Beat the Miner ${day}, block ${height.toLocaleString('en-US')}: ${fees.toLocaleString('en-US')} sats, ${ofMiner}% of the miner`,
    ...(streak > 1 ? [`🔥 ${streak}-day streak`] : []),
    ofMiner > 100 ? 'I beat the miner! Can you?' : 'The miner got me today. Can you beat it?',
    `${url} #${GAME_TAG}`,
  ].join('\n')
}
