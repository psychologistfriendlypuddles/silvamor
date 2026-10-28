// Sharing a finished run as a public note (kind 1) on the player's own relays.

/** "12,345 sats" */
export const sats = (n: number) => `${n.toLocaleString('en-US')} sats`

/** The note offered after a run, for the player to edit before posting. */
export function shareText(day: string, height: number, fees: number, ofMiner: number, url: string): string {
  return [
    `⛏️ Beat the Miner ${day}, block ${height.toLocaleString('en-US')}: ${fees.toLocaleString('en-US')} sats, ${ofMiner}% of the miner`,
    ofMiner > 100 ? 'I beat the miner! Can you?' : 'The miner got me today. Can you beat it?',
    url,
  ].join('\n')
}
