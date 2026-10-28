// The offer to share a result is made once a day per game: dismissing or posting both count.

const offeredKey = (game: string, pubkey: string) => `silvamor:share-offered:${game}:${pubkey}`

export function shareOffered(game: string, pubkey: string, day: string): boolean {
  try {
    return localStorage.getItem(offeredKey(game, pubkey)) === day
  } catch {
    return false
  }
}

export function markShareOffered(game: string, pubkey: string, day: string) {
  try {
    localStorage.setItem(offeredKey(game, pubkey), day)
  } catch {
    // Storage blocked: the offer may come back on a reload, which is harmless.
  }
}
