/** Features that are built but switched off for now. */
export const FEATURES = {
  /** Win/loss record and reliability (docs/PROTOCOL.md, "Ratings"). Hidden until after launch. */
  ratings: false,
  /**
   * Friendly wagers and the wager honor badges (docs/PROTOCOL.md, "Wagers"). Off unless the app is
   * built with VITE_ENABLE_WAGERS=true: betting on games is restricted in many places, so only turn
   * this on where it's lawful (see docs/DEPLOY.md). While off, Silvamor offers no wagers, doesn't
   * list or join other clients' wager games, and shows no honor badges.
   */
  wagers: import.meta.env.VITE_ENABLE_WAGERS === 'true',
}
