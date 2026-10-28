# Silvamor protocol (draft v1)

How Silvamor's daily game is dealt, published and ranked using plain Nostr events. Any client that
follows this document can deal the same game, check anyone's score and build the same
leaderboards. No server is involved.

## Event kinds

| Kind    | Type        | Author | Purpose                                      |
|---------|-------------|--------|----------------------------------------------|
| `1953`  | regular     | player | Block of the Day run (see "Publishing a run")  |
| `30951` | addressable | artist | Player sprite (see [SPRITES.md](SPRITES.md)) |

Standard Nostr events the app also uses:

| Kind | NIP | Used for |
|------|-----|----------|
| `9734` / `9735` | NIP-57 | Tips: zap requests and receipts. Tips to players are plain zaps with no `a` tag; tips to artists carry the sprite's address |
| `30000` | NIP-51 | Leagues (follow sets) |
| `30004` | NIP-51 | Featured sprites (curation set, `d=silvamor-sprites`) |
| `30078` | NIP-78 | Sprite choice (`d=silvamor/sprite`) and private settings (`d=silvamor/moderation`, NIP-44 encrypted to yourself) |
| `1984` | NIP-56 | Sprite reports |
| `5` | NIP-09 | Deleting a league |
| `1` | NIP-01 | Sharing a result: a note carrying the game's hashtag (`t` tag), sent to the player's own relays; the Social feed reads these |
| `62` | NIP-62 | "Delete my data": a request to vanish naming only Silvamor's relay (`relay` tag), sent there alone |
| `10000` | NIP-51 | Mute list (read only: muted artists are hidden) |
| `0`, `3`, `10002` | NIP-01/02/65 | Profiles, follows (leaderboards, friend picker, report counting), relay lists |
| `24133` | NIP-46 | Talking to signer apps |
| `23194` / `23195` | NIP-47 | Paying through a connected wallet (Nostr Wallet Connect) |
| `27235` / `24242` | NIP-98 / Blossom | Signed requests to the push service and upload server |

## The day's seed block

Days are UTC dates (`YYYY-MM-DD`) starting at 00:00 UTC. A day's seed block is the lowest-height
Bitcoin block whose header timestamp is at or after 00:00 UTC that day, so nobody knows the day's game
before it's mined (usually within about 10 minutes). Block timestamps are set by miners and can run up
to about two hours fast, so clients looking for the seed block check blocks back to two hours before
midnight.

**The generator.** A seed is 64 lowercase hex characters. Split it into eight big-endian 32-bit
words w0..w7 and seed an sfc32 generator with a = w0^w4, b = w1^w5, c = w2^w6, d = w3^w7, then drop
its first 15 outputs. `below(n)` is floor(u × n / 2³²) for the next output u. A shuffle is
Fisher–Yates from the end: for i = n−1 down to 1, swap item i with item `below(i + 1)`.

## Block of the Day

Each day's game is built from the day's seed block. Its seed is
`sha256("silvamor/miner/<YYYY-MM-DD>/<seed block hash>")`, hex, driving the generator above. The
reference code is `src/games/miner/rules.ts`.

**The day's transactions.** Clients read the block's transaction count (Esplora `GET /block/:hash`,
`tx_count`) and 4 pages of 25 transactions (`GET /block/:hash/txs/:start`). Page `i` (0–3) starts at
`floor((1 + i·span + below(span)) / 25) · 25`, with `span = floor((tx_count − 1) / 4)` and `below(n)`
the generator's next output scaled to 0…n−1; repeated starts are read once. From the pages:
- the coinbase, and transactions over 1,500 vbytes (`ceil(weight / 4)`), are left out;
- a transaction spending from one other transaction on the pages, which itself spends from none of
  them, is that one's *child* (at most 2 per parent, lowest txids first); other transactions spending
  from ones on the pages are left out;
- the rest are *roots*. Roots are sorted by txid and shuffled, after 4 generator outputs are skipped
  (the ones the page starts used); each root is added with its children while they fit in 30;
- the 30 (or fewer) are shuffled again, and a child that would arrive before its parent moves to just
  after it.

Your block has room for `round(0.45 × total vbytes)`. The block is found after
`min(18, n) + below(n − min(18, n) + 1)` arrivals, `n` being the number of transactions.

**Playing.** Transactions are offered in order. For each one the player either takes it (it must fit,
and a child's parent must already be in the block) or passes on it for good. When the number of
moves reaches the find point, the block is found and the run is over; its score is the fees taken.

**The miner** takes a transaction when it fits, its parent (if any) is in, and its fee rate is at least
the average fee rate of everything offered so far, this one included. The best possible block is a
knapsack over what arrived before the block was found (each parent with any set of its children).

### Publishing a run (kind 1953)

When the block is found, the player publishes their run once:

```json
{ "kind": 1953, "content": "{\"moves\":\"tpptt…\"}",
  "tags": [["L", "silvamor/miner"], ["l", "<day>", "silvamor/miner"],
           ["block", "<seed block height>", "<seed block hash>"], ["score", "<sats>"],
           ["streak", "<days in a row>"],
           ["alt", "Block of the Day on Silvamor: <sats> sats in fees"]] }
```

`moves` has one letter per transaction offered: `t` (take) or `p` (pass). The NIP-32 label (`l`)
lets clients ask relays for one day's runs (`#l`). A run counts when:
- its `block` tag is that day's seed block;
- its `created_at` is on its day: at or after 00:00 UTC, and before 02:00 UTC the next day (a run
  started just before midnight still counts);
- its moves replay on the day's transactions to a finished run whose fees are exactly its `score`.

Only each player's first run counts: their valid run with the lowest `created_at` (the lower event id
breaks a tie). Later runs are ignored, and clients let a player publish only one run a day. Since
every game is fixed once its block is mined, this works on the honour system: nothing stops practice
runs on another key or offline. Clients hide others' results (whose moves are public) until the
player has played.

**Boards** read runs from relay.silvamor.com, which replays each run before keeping it. It takes a
run only as it's made (its `created_at` within 30 minutes of the relay's clock), so a past day can't
be played later, and refuses runs it can't check yet; the app then offers to publish again. Runs it
stored without checking (while its checker was down) are checked within minutes and deleted if they
fail. Top Scores
add up each player's counted fees over today, 7 or 21 days (ties go to the earlier first run); Top
Streaks rank the streaks of runs from today and yesterday (a streak still counts until the day
after it ends). A league's standings are the same as Top Scores, among its players and the player.
Today's scores stay hidden until the player has played.

**Streaks.** The `streak` tag counts the days in a row the player has played, this one included.
A run claiming N > 1 only counts as a streak if the player's run for the day before, on
relay.silvamor.com, claims N − 1; otherwise it shows as a first day. relay.silvamor.com checks the
same link when it takes a run, so a streak is a chain of such links, each checked when it was made.
Each check needs only the day before, so runs deleted after 30 days don't break a streak. A missing
or unreadable `streak` tag counts as 1. Clients claim one more than the largest streak on their own
runs for the day before.

## Leagues

Leagues are standard NIP-51 follow sets (kind `30000`), so other Nostr apps can show them too:
`["d", id]`, `["title", name]` and one `["p", pubkey]` tag per player. Each league has its own
standings (see Boards above). When reading, members that other apps stored as NIP-51 private items
(encrypted `content`) are merged in.
- **Deleting:** a NIP-09 deletion request (kind 5 with an `a` tag) plus a replacement with a
  `["deleted"]` tag for relays that ignore deletions.

## Sprites

Each player picks an animated sprite: it cheers them on during their run and stands on the
podiums. The sheet format, the sprite event (kind 30951) and the choice event
(kind 30078) are specified in [SPRITES.md](SPRITES.md).
