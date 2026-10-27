import type { Notice } from './notifications'

/** How a notice reads, given the other person's display name. */
export function noticeText(n: Notice, name: string): { emoji: string; text: string } {
  return { emoji: '🃏', text: `${name} beat your Daily Deal score with ${n.score.toLocaleString('en-US')}` }
}
