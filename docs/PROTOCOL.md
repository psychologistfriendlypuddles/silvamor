# Silvamor game protocol (draft v1)

How games are announced, joined and played using plain Nostr events. Any client that follows this
document can list, join, play and spectate games, and replay them later. No server is involved.

## Event kinds

| Kind    | Type        | Author        | Purpose                               |
|---------|-------------|---------------|---------------------------------------|
| `30950` | addressable | host          | Game listing (lobby entry)            |
| `1950`  | regular     | player        | Request to join a game                |
| `1951`  | regular     | host / player / anyone | Game action: start, move, resign, strike |
| `30951` | addressable | artist        | Player sprite (see [SPRITES.md](SPRITES.md)) |

Standard Nostr events the app also uses:

| Kind | NIP | Used for |
|------|-----|----------|
| `1111` | NIP-22 | In-game chat (see "Chat") |
| `9734` / `9735` | NIP-57 | Tips and wager payments: zap requests and receipts. Tips to players are plain zaps with no `a` tag (never tied to a game); tips to artists carry the sprite's address; wager payments carry the game's |
| `30000` | NIP-51 | Groups (follow sets) |
| `30004` | NIP-51 | Featured sprites (curation set, `d=silvamor-sprites`) |
| `30078` | NIP-78 | Sprite choice (`d=silvamor/sprite`) and private settings (`d=silvamor/moderation`, NIP-44 encrypted to yourself) |
| `1984` | NIP-56 | Sprite reports |
| `10000` | NIP-51 | Mute list (read only: muted artists are hidden) |
| `0`, `3`, `10002` | NIP-01/02/65 | Profiles, follows (friend picker, report counting), relay lists |
| `24133` | NIP-46 | Talking to signer apps |
| `23194` / `23195` | NIP-47 | Paying through a connected wallet (Nostr Wallet Connect) |
| `27235` / `24242` | NIP-98 / Blossom | Signed requests to the push service and upload server |

Games may have variants, chosen at creation and stored as `["option", key, value]` tags on the
listing (e.g. the dots and boxes board size). Clients skip listings whose options they don't support.

A game is identified by its listing coordinate `30950:<host pubkey>:<d>`, written as an `a` tag on
every join and action. `d` is a random 16-hex-character id.

## Game listing (kind 30950)

```jsonc
{
  "kind": 30950,
  "content": "{\"title\":\"Friday night match\",\"invite\":\"<link games only: token, NIP-44 encrypted to the host>\"}",
  "tags": [
    ["d", "9f2c1a7b3e8d4c10"],
    ["t", "silvamor"],
    ["game", "tictactoe"],
    ["status", "open"],            // open | active | finished | cancelled
    ["access", "open"],            // open | invite | link
    ["blocks", "3"],               // optional: turn clock, in Bitcoin blocks
    ["wager", "21"],               // optional: friendly wager in sats (see "Wagers")
    ["option", "size", "9"],       // optional game variant (board size for dots and boxes and Go)
    ["p", "<pubkey>"],             // invite games: invited players. Once started: the players.
    ["e", "<start action id>"],    // once started
    ["alt", "Tic-Tac-Toe game on Silvamor"]
  ]
}
```

The listing is replaced by the host as the game moves along. Its `status` is a *hint* for the
lobby. The truth is always the chain of actions below, which any client can replay.

## Joining (kind 1950)

```jsonc
{ "kind": 1950, "content": "<proof, link games only>",
  "tags": [["a", "30950:<host>:<d>"], ["p", "<host>"]] }
```

The host's client accepts the first valid join it sees by publishing the **start** action. A join
is valid when:
- `access=open`: anyone.
- `access=invite`: the joiner's pubkey is in the listing's `p` tags.
- `access=link`: `content` is a valid invite proof (see "Invite links") for the joiner's pubkey.
- Wager games: the join repeats the stake as `["wager", "<sats>"]` (the joiner signs that they
  agree to it), and the joiner's profile has a Lightning address that accepts zaps.

Once the host publishes the start action the seat is taken, so later joins (including a second use
of the same invite link) are ignored. Clients skip listings whose `access` they don't recognise.

## Actions (kind 1951)

```jsonc
{ "kind": 1951, "content": "<JSON>",
  "tags": [["a", "30950:<host>:<d>"], ["e", "<previous action id>"], ["p", "<other player>"],
           ["block", "<Bitcoin block height when made>"]] }
```

Content JSON by `type`:

| type     | fields                         | who                    |
|----------|--------------------------------|------------------------|
| `start`  | `n: 0`, `players: [pk, pk]`    | host only; no `e` tag  |
| `move`   | `n`, `move` (game-specific)    | player whose turn it is |
| `resign` | `n`                            | either player          |
| `strike` | `n`                            | anyone (see Turn clock) |

`players[0]` moves first. The host decides the order (random by default).

### Replay and validation

Actions form a hash chain: each action's `e` tag points to the previous action's id, and `n`
counts up from 0. To get the game state, a client:

1. Takes the earliest `start` authored by the host.
2. Repeatedly picks the child action whose `e` is the current tip, whose `n` is tip `n + 1`,
   whose author is allowed to act, and whose move is legal under the game rules.
3. Stops at the end of the game or when there is no valid child.

Invalid actions (wrong author, wrong turn, illegal move, bad `n`, and for clocked games a `block`
lower than the previous action's or not mined yet) are ignored. A valid `strike` beats any competing
action on the same tip. If a player signs two different valid moves on the same tip, that's
equivocation: clients pick the lowest `(created_at, id)` and mark the game as **forked**.

### Turn clock (Bitcoin blocks, three strikes)

A listing's `blocks` tag (S) sets the turn clock. Time is measured in Bitcoin block height, which
every client agrees on and nobody can post-date. Every action in a clocked game carries a `block`
tag: the newest block its author knew of. Clients get the height from several sources and use the
lowest answer, so a lagging or wrong source can only delay a strike.

**When strikes land.** For the player on turn, a strike lands when block **x + S** is mined, where x
is the block recorded by the previous action: the game `start` (the host admitting the challenger,
so waiting for an opponent never counts), the opponent's `move`, or the player's own previous
`strike`. Strike k after an action at block x lands at x + k·S.

What a strike does to the turn depends on the game:
- **Keep the turn** (every game except dots and boxes): the struck player can still move, and their
  next strike lands S blocks after this one.
- **Pass the turn** (dots and boxes): the turn goes to the opponent, whose clock starts at the strike
  block. A move by the struck player recording that block or later is too late and ignored.

Strikes add up over the whole game, and a player's **third strike loses the game** (outcome reason
`strikes`).

Example, S = 3: opponent moves at 800,000. A move recording 800,001 or 800,002 is on time; strikes
land at 800,003, 800,006 and 800,009 (out). If the player moves at 800,004 (one strike) and the
opponent replies at 800,004, the next strikes land at 800,007 (two) and 800,010 (out). With S = 1 a
strike lands on the very next block, which can be seconds away.

**Every client can work it out.** From the action chain and the current block height, any client
(player or spectator, even after both players were away for weeks) finds whose turn was pending and
how many strikes that player has run up, so all agree on the loser.

**Filing strikes.** Strikes are counted as soon as they land, but a late move recording an older
block could otherwise hide them. So once a strike's block has been known for a 60 second grace period
(for moves still in flight), any client files a `strike` action recording exactly that block. Any
author may file it, since it is objectively checkable. A filed strike beats any competing action on the
same tip, so a backdated move can no longer erase it. The waiting opponent's app files first; other
clients wait 10 to 20 seconds and stand down if it arrives.

**Late moves.** In games where the struck player keeps the turn, a move recording a block at or after
a strike block is still valid and brings the strikes it ran up, unless that makes three, in which case
the player had already lost and the move is ignored. In games where a strike passes the turn, the next
player must build on the filed strike, so their client files any due strikes just before moving.

**Limitation.** A move's `block` can't be later than the newest block, but its author could still
record a slightly older one (no lower than the previous action's) to look on time. Filed strikes stop
this once a strike is due; within a turn's window it only buys thinking time.

## Chat

In-game chat uses NIP-22 comments (kind `1111`) on the game listing, so other Nostr apps can show
the thread:

```jsonc
{ "kind": 1111, "content": "gl hf",
  "tags": [["A", "30950:<host>:<d>"], ["K", "30950"], ["P", "<host>"],
           ["a", "30950:<host>:<d>"], ["k", "30950"], ["p", "<other player>"]] }
```

Chat is for the players: clients show (and offer to send) messages only between the game's
players and ignore comments from anyone else. Messages are readable on relays like moves are;
the app limits who takes part, it does not encrypt.

## Invite links

A link game (`access=link`) is joinable by whoever redeems its single-use invite link first.

- The host generates a random 128-bit `token` (32 hex chars) and stores it in the listing's
  `content.invite`, NIP-44 encrypted to their own pubkey, so any device with the host's signer can
  share the link.
- The link is the game URL with `#invite=<token>` appended. The fragment is never sent to web servers.
- `key = SHA-256("silvamor-invite:" + token)`, used as a NIP-44 v2 conversation key.
- A joiner's proof is `nip44.encrypt(joinerPubkey, key)`. The host accepts a join when the proof
  decrypts to the joiner's own pubkey, so a proof copied off a relay is useless to anyone else.

Moves in link games are public like any other game: the link controls who can *play*, not who can watch.

## Game rules

| `game`      | move                 | notes                     |
|-------------|----------------------|---------------------------|
| `tictactoe` | `{ "cell": 0..8 }`   | cells row-major from top-left |
| `fourinarow` | `{ "col": 0..6 }`   | 7 columns × 6 rows; the disc drops to the lowest empty cell; four in a row (any direction) wins; full board is a draw |
| `dotsandboxes` | `{ "edge": n }` | N × N boxes, from the listing's `["option", "size", "N"]` tag (any integer 2–20; clients offer 8, 12, 16 and 20; no tag means 4). Edges `0..N(N+1)-1` are horizontal, `r * N + c` (r 0..N, c 0..N-1); the rest are vertical, `N(N+1) + r * (N+1) + c` (r 0..N-1, c 0..N). Completing a box scores it and the same player moves again; most boxes wins, a tie is a draw |
| `chess` | `{ "from": "e2", "to": "e4", "promotion"?: "q"\|"r"\|"b"\|"n" }` | `players[0]` is White. Standard rules (via chess.js): castling, en passant, promotion (must name the piece). Checkmate wins; stalemate, insufficient material, the 50-move rule and threefold repetition are automatic draws |
| `reversi` | `{ "cell": 0..63 }` | 8 × 8, row-major. `players[0]` is dark and starts; the centre starts with dark on cells 28 and 35, light on 27 and 36. A move must flip at least one disc; a player with no move passes automatically; the game ends when neither can move, most discs wins |
| `checkers` | `{ "path": [from, landing, …] }` | English draughts on the dark squares of an 8 × 8 board (row-major). `players[0]` starts at the bottom and moves first. Captures are compulsory and a multi-jump is one move listing every landing square; crowning ends a move; kings move one square either way. No legal move loses; 80 moves in a row without a capture or a man moving is a draw |
| `go` | `{ "point": n }` or `{ "pass": true }` | N × N from `["option", "size", "N"]` (5–19; clients offer 9, 13, 19; no tag means 9). `players[0]` is Black. Suicide is illegal; positional superko (no repeated position). Two passes in a row end it; area scoring (stones + empty points reaching only that colour), komi 7.5 |
| `gomoku` | `{ "cell": 0..224 }` | 15 × 15 intersections, row-major. `players[0]` is Black. Five or more in a row wins; a full board is a draw |
| `morris` | `{ "to": p, "from"?: p, "remove"?: p }` | Nine men's morris, points 0–23 numbered row by row (see `src/games/morris/rules.ts`). Place 9 pieces each, then slide along lines, flying when down to 3. A move that closes a mill must name an opponent piece to remove (not from a mill unless all are). Fewer than 3 pieces or no move loses; 100 moves in a row without a removal is a draw |

Turn order comes from the game's rules, not strict alternation: in dots and boxes a player who
completes a box acts again (the turn clock then starts from their own previous move), and in reversi
a player with no legal move is skipped. In Go, passing is a move.

## Ratings

Ratings are never submitted by players. Each client computes them from games it can replay
so sore losers can't hand out bad scores. Record and reliability are built but not shown in the app
yet; honor is.

- **Record** (wins / losses / draws) uses the **unique-opponent rule**: games are grouped per
  opponent and only the overall head-to-head result against each opponent counts (net wins > 0 is
  a win, < 0 a loss, 0 a draw). Playing the same friend 100 times counts the same as playing them once.
- **Reliability** is the share of games finished properly (by the rules, by resignation, or as a
  draw), as opposed to struck out. It's averaged per opponent, so farming finished games against
  one friend can't hide strike-outs against others.
- **Honor** tracks whether players paid the wagers they lost (see "Wagers").

## Wagers

A friendly wager is an **honor system**: nobody holds the stake, and nothing forces the loser to
pay. The protocol only makes paying easy and the record public.

Silvamor ships with wagers switched off (see docs/DEPLOY.md): it then never creates wager games,
doesn't list or join listings with a `wager` tag, and shows no honor badges.

- The listing's `wager` tag is the stake in sats (1 to 100,000,000). Both players need a
  Lightning address (`lud16`) whose LNURL-pay endpoint has `allowsNostr` and a `nostrPubkey`, so
  payments produce zap receipts. The host's client refuses joins without one.
- When the game ends with a winner, the loser pays with a NIP-57 zap: a kind 9734 zap request
  with `["p", <winner>]`, `["amount", <sats × 1000>]`, `["a", "30950:<host>:<d>"]` and
  `["k", "30950"]`. A draw pays nothing.
- The winner's Lightning provider publishes the kind 9735 receipt. Clients find payments with
  `{"kinds": [9735], "#a": [<coordinate>]}` and only count a receipt that is signed by the winner's
  provider (`nostrPubkey`), embeds a valid zap request from the loser to the winner for this game,
  and whose bolt11 amount is at least the stake.

### Honor badge

Every client works out each player's badge from their finished games (listings with their `p`
tag, replayed) and the receipts. A lost wager is *pending* for 24 hours after the game's last
action, then *unpaid* until a receipt shows up.

| Badge  | Rule |
|--------|------|
| Red    | Owes a wager more than 24 hours overdue. Paying it clears red at once. |
| Gold   | Paid lost wagers to 25+ different winners |
| Silver | Paid lost wagers to 10+ different winners |
| Bronze | Paid every lost wager (at least one) |
| New    | Hasn't lost a wager yet |

Counting *different* winners means trading small wagers back and forth with one friend can't
farm a tier. Games without wagers don't affect the badge.

## Groups

Groups are standard NIP-51 follow sets (kind `30000`), so other Nostr apps can show them too:
`["d", id]`, `["title", name]` and one `["p", pubkey]` tag per member. Groups are public by
design, since a game for a group lists its invitees publicly anyway. When reading, members that
other apps stored as NIP-51 private items (encrypted `content`) are merged in.
- **Deleting:** a NIP-09 deletion request (kind 5 with an `a` tag) plus a replacement with a
  `["deleted"]` tag for relays that ignore deletions.

A game "for a group" is a normal `access=invite` game whose invite list is the group's members at
creation time. The group itself isn't referenced, so later changes to the group don't affect
games already created.

## Sprites

Each player picks an animated sprite that stands in their corner of a match. The sheet format,
the sprite event (kind 30951) and the choice event (kind 30078) are specified in
[SPRITES.md](SPRITES.md).
