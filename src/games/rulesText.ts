// The "Rules" sheet for each game: how to play, and what running out of time does.

export interface RulesText {
  goal: string
  howToPlay: string[]
  /** What a turn-clock strike does in this game (shown with the general clock rules). */
  timeout: string
}

const KEEP_TURN = 'Run out of time and you get a strike but keep your turn: the clock starts again from the strike.'

export const RULES_TEXT: Record<string, RulesText> = {
  tictactoe: {
    goal: 'Get three of your marks in a row: across, down or diagonally.',
    howToPlay: [
      'Players take turns placing their mark (✕ or ◯) in an empty square.',
      'Who goes first is picked at random when the game starts.',
      'If all nine squares fill up without a line of three, it’s a draw.',
    ],
    timeout: KEEP_TURN,
  },
  fourinarow: {
    goal: 'Line up four of your discs in a row: across, down or diagonally.',
    howToPlay: [
      'The board has 7 columns and 6 rows. On your turn, drop a disc into a column that isn’t full; it falls to the lowest empty space.',
      'Who goes first is picked at random when the game starts.',
      'If the board fills up without a line of four, it’s a draw.',
    ],
    timeout: KEEP_TURN,
  },
  dotsandboxes: {
    goal: 'Complete more boxes than your opponent.',
    howToPlay: [
      'On your turn, draw one line between two neighbouring dots.',
      'Draw the fourth side of a box and it’s yours, and you take another turn. Completing two boxes with one line counts both.',
      'The game ends when every line is drawn. Most boxes wins; equal boxes is a draw.',
      'On a phone, big boards ask you to confirm a line in a magnifier, and you can pinch to zoom.',
    ],
    timeout: 'Run out of time and you get a strike, and the turn passes to your opponent, whose clock starts from the strike.',
  },
  chess: {
    goal: 'Checkmate your opponent’s king: put it in check with no way out.',
    howToPlay: [
      'Standard chess rules. The player picked to go first plays White.',
      'Castling, en passant and promotion all work. When a pawn reaches the last rank you pick the piece.',
      'Draws happen automatically on stalemate, insufficient material, threefold repetition or the 50-move rule.',
    ],
    timeout: KEEP_TURN,
  },
  reversi: {
    goal: 'Have more discs of your colour on the board when it’s over.',
    howToPlay: [
      'Place a disc so that it traps a straight line of your opponent’s discs between it and another of yours (across, down or diagonally). Every trapped disc flips to your colour.',
      'A move must flip at least one disc. If you have no such move, your turn passes automatically.',
      'The game ends when neither player can move. Most discs wins; equal is a draw.',
      'Dark (the player picked to go first) moves first.',
    ],
    timeout: KEEP_TURN,
  },
  checkers: {
    goal: 'Capture all of your opponent’s pieces, or leave them with no move.',
    howToPlay: [
      'Pieces move one square diagonally forward onto the dark squares.',
      'Capture by jumping over an opponent’s piece to the empty square beyond. Captures are compulsory, and if another jump follows you must keep going: tap each landing square in turn.',
      'A piece that reaches the far row becomes a king 👑 and can move and capture backwards too. Being crowned ends the move.',
      'After 40 moves each without a capture or a plain piece moving, the game is a draw.',
      'Red (the player picked to go first) moves first.',
    ],
    timeout: KEEP_TURN,
  },
  go: {
    goal: 'Control more of the board than your opponent: your stones plus the empty points only you surround.',
    howToPlay: [
      'Players take turns placing a stone on an empty intersection. Black (the player picked to go first) starts.',
      'Stones next to each other along the lines form a group. A group with no empty points next to it is captured and removed.',
      'You can’t play where your stone would have no liberties (unless it captures), and no move may recreate an earlier position (this is the ko rule).',
      'You may pass. Two passes in a row end the game, and every stone still on the board counts as alive, so capture dead stones before passing.',
      'Score = your stones + empty points surrounded only by your stones. White gets 7.5 extra points (komi) for moving second, so there are no draws.',
      'On a phone, tap a point to preview your stone and tap it again to place it.',
    ],
    timeout: KEEP_TURN,
  },
  gomoku: {
    goal: 'Get five (or more) of your stones in an unbroken row: across, down or diagonally.',
    howToPlay: [
      'Players take turns placing a stone on an empty intersection of the 15×15 board. Black (the player picked to go first) starts.',
      'Stones are never moved or removed.',
      'If the board fills up without a row of five, it’s a draw.',
      'On a phone, tap a point to preview your stone and tap it again to place it.',
    ],
    timeout: KEEP_TURN,
  },
  morris: {
    goal: 'Leave your opponent with fewer than three pieces, or with no move.',
    howToPlay: [
      'Each player has nine pieces. First, take turns placing them on empty points.',
      'Once all are placed, take turns sliding a piece along a line to a neighbouring empty point.',
      'Three of your pieces in a row along a line is a mill: when you make one, remove one of your opponent’s pieces. Pieces in a mill are safe unless all of theirs are in mills.',
      'When you’re down to three pieces, they can fly to any empty point.',
      'After 50 moves each without a piece being removed, the game is a draw.',
    ],
    timeout: KEEP_TURN,
  },
}
