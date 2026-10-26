import type { Notice } from './notifications'

/** How a notice reads, given the other person's display name and the game's title. */
export function noticeText(n: Notice, name: string, title: string): { emoji: string; text: string } {
  switch (n.kind) {
    case 'invited':
      return { emoji: '💌', text: `${name} invited you to play ${title}` }
    case 'joined':
      return { emoji: '🎉', text: `${name} joined your game: ${title}` }
    case 'turn':
      return { emoji: '🎯', text: `Your turn in ${title}` }
    case 'strikeSoon':
      return { emoji: '⏱️', text: `1 block left before a strike in ${title}` }
    case 'strike':
      return n.mine
        ? { emoji: '⚡', text: `Strike ${n.detail} of 3 for you in ${title}` }
        : { emoji: '⚡', text: `${name} got strike ${n.detail} of 3 in ${title}` }
    case 'ended':
      return n.detail === 'won'
        ? { emoji: '🏆', text: `You won ${title}!` }
        : n.detail === 'lost'
          ? { emoji: '😭', text: `You lost ${title}` }
          : { emoji: '🤝', text: `${title} ended in a draw` }
    case 'chat':
      return { emoji: '💬', text: `${name}: ${n.detail}` }
  }
}
