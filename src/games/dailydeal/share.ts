import { HAND_BASE, type HandType, type Play } from './rules'

// Sharing a finished run as a public note (kind 1) on the player's own relays.

const RANK = Object.keys(HAND_BASE) as HandType[]

/** The note offered after a run, for the player to edit before posting. */
export function shareText(day: string, score: number, streak: number, plays: Play[], url: string): string {
  const best = plays.reduce<HandType | null>((top, p) => (top === null || RANK.indexOf(p.hand) > RANK.indexOf(top) ? p.hand : top), null)
  return [
    `🃏 Daily Deal ${day}: ${score.toLocaleString('en-US')} points`,
    ...(best ? [`Best hand: ${HAND_BASE[best].name}`] : []),
    ...(streak > 1 ? [`🔥 ${streak}-day streak`] : []),
    'Same cards for everyone today. Can you beat me?',
    url,
  ].join('\n')
}
