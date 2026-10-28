# Silvamor protocol (draft v1)

How Daily Deal runs are dealt, published and ranked using plain Nostr events. Any client that
follows this document can deal the same cards, check anyone's score and build the same
leaderboards. No server is involved.

## Event kinds

| Kind    | Type        | Author | Purpose                                      |
|---------|-------------|--------|----------------------------------------------|
| `1952`  | regular     | player | Daily Deal run (see "Publishing a run")      |
| `1953`  | regular     | player | Beat the Miner run (see "Beat the Miner")    |
| `30951` | addressable | artist | Player sprite (see [SPRITES.md](SPRITES.md)) |

Standard Nostr events the app also uses:

| Kind | NIP | Used for |
|------|-----|----------|
| `9734` / `9735` | NIP-57 | Tips: zap requests and receipts. Tips to players are plain zaps with no `a` tag; tips to artists carry the sprite's address |
| `30000` | NIP-51 | Groups (follow sets) |
| `30004` | NIP-51 | Featured sprites (curation set, `d=silvamor-sprites`) |
| `30078` | NIP-78 | Sprite choice (`d=silvamor/sprite`) and private settings (`d=silvamor/moderation`, NIP-44 encrypted to yourself) |
| `1984` | NIP-56 | Sprite reports |
| `5` | NIP-09 | Deleting a group |
| `62` | NIP-62 | "Delete my data": a request to vanish naming only Silvamor's relay (`relay` tag), sent there alone |
| `10000` | NIP-51 | Mute list (read only: muted artists are hidden) |
| `0`, `3`, `10002` | NIP-01/02/65 | Profiles, follows (leaderboards, friend picker, report counting), relay lists |
| `24133` | NIP-46 | Talking to signer apps |
| `23194` / `23195` | NIP-47 | Paying through a connected wallet (Nostr Wallet Connect) |
| `27235` / `24242` | NIP-98 / Blossom | Signed requests to the push service and upload server |

## Beat the Miner

Each day's game is built from the same seed block as Daily Deal: the lowest-height block whose
timestamp is at or after 00:00 UTC (see "Daily Deal" for how clients find it). Its seed is
`sha256("silvamor/miner/<YYYY-MM-DD>/<seed block hash>")`, hex, driving the same sfc32 generator.
The reference code is `src/games/miner/rules.ts`.

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

**Publishing a run (kind 1953):**

```json
{ "kind": 1953, "content": "{\"moves\":\"tpptt…\"}",
  "tags": [["L", "silvamor/miner"], ["l", "<day>", "silvamor/miner"],
           ["block", "<seed block height>", "<seed block hash>"], ["score", "<sats>"],
           ["alt", "Beat the Miner on Silvamor: <sats> sats in fees"]] }
```

`moves` has one letter per transaction offered: `t` (take) or `p` (pass). A run counts under the same
conditions as a Daily Deal run (its seed block, made during its day, its moves replay to exactly its
`score`), and only each player's first one counts. Leaderboards rank by fees.

## Daily Deal

A one-player card run (`src/games/dailydeal/rules.ts`). Everyone who plays the same seed gets the
same deck and perks, so any client can replay a run and check its score.

**The day's seed.** Days are UTC dates (`YYYY-MM-DD`) starting at 00:00 UTC. A day's seed block is
the lowest-height Bitcoin block whose header timestamp is at or after 00:00 UTC that day, so nobody
knows the deal before it's mined (usually within about 10 minutes). The seed is the lowercase hex
SHA-256 of the UTF-8 string `silvamor/dailydeal/<day>/<block hash>`, the hash in its usual lowercase
hex. Block timestamps are set by miners and can run up to about two hours fast, so clients looking for
the seed block check blocks back to two hours before midnight.

**Seed and shuffle.** The seed is 64 lowercase hex characters. Split it into eight big-endian
32-bit words w0..w7 and seed an sfc32 generator with a = w0^w4, b = w1^w5, c = w2^w6, d = w3^w7,
then drop its first 15 outputs. `below(n)` is floor(u × n / 2³²) for the next output u. A shuffle is
Fisher–Yates from the end: for i = n−1 down to 1, swap item i with item `below(i + 1)`. From one
generator, in this order:
1. Shuffle the perk kinds `suit, faces, evens, pairs, small, straights, flushes, extraHand, finale`
   and take the first 3. If `suit` is among them, `below(4)` picks its suit, in the order taken.
2. Shuffle cards 0..51 (suit = card ÷ 13 in the order ♠ ♥ ♦ ♣, rank = card mod 13 from 2 up to the
   ace). The first 8 are the starting hand; the rest are drawn in order.

**Playing.** 4 hands to play (5 with `extraHand`) and 3 discards. A move is `{ "play": [cards] }` or
`{ "discard": [cards] }` with 1–5 distinct cards from the hand; afterwards the hand draws back up to
8. The run ends when the last hand is played; its score is the sum of the hands' points.

**Scoring.** A play makes the best of these hands (straights and flushes need all 5 cards; A-2-3-4-5
counts as a straight, but straights don't wrap past the ace):

| hand | chips × mult | scoring cards |
|------|--------------|---------------|
| High card | 5 × 1 | the highest card |
| Pair | 10 × 2 | the pair |
| Two pair | 20 × 2 | both pairs |
| Three of a kind | 30 × 3 | the three |
| Straight | 30 × 4 | all |
| Flush | 35 × 4 | all |
| Full house | 40 × 4 | all |
| Four of a kind | 60 × 7 | the four |
| Straight flush | 100 × 8 | all |

Each scoring card adds its chips (face value, 10 for J/Q/K, 11 for an ace). Then the adding perks
apply, per scoring card: `suit` +3 mult for that suit, `faces` +20 chips for J/Q/K, `evens` +2 mult
for 2/4/6/8/10. Then the multiplying perks: `pairs` ×3 on a pair or two pair, `small` ×2 when 3 or
fewer cards are played, `straights` ×3 on a straight or straight flush, `flushes` ×3 on a flush or
straight flush, `finale` ×2 on the last hand. Points = chips × mult.

### Publishing a run (kind 1952)

When a run ends, the player publishes it once:

```json
{ "kind": 1952, "content": "{\"moves\":[{\"discard\":[3,17]},{\"play\":[8,21,34]},…]}",
  "tags": [["L", "silvamor/dailydeal"], ["l", "<day>", "silvamor/dailydeal"],
           ["block", "<seed block height>", "<seed block hash>"], ["score", "<points>"],
           ["streak", "<days in a row>"], ["p", "<friend beaten>"], …, ["alt", "Daily Deal run on Silvamor: <points> points"]] }
```

The NIP-32 label (`l`) lets clients ask relays for one day's runs (`#l`). A run counts when:
- its `block` tag is that day's seed block;
- its `created_at` is at or after 00:00 UTC on its day, and before the timestamp of the next day's
  seed block (once that block exists);
- its moves replay, from the seed, to a finished run that scores exactly its `score` tag.

Only each player's first run counts: their valid run with the lowest `created_at` (the lower event id
breaks a tie). Later runs are ignored, and clients let a player publish only one run a day. Since
every deal is fixed once its block is mined, this works on the honour system: nothing stops practice
runs on another key or offline. Clients hide other players' scores (whose moves are public) until the
player has finished their own run.

**Leaderboards** rank the day's counted runs by score (then earlier `created_at`) among the people
the player follows (kind 3) or among the members of one of their groups, the player included.

**Streaks.** The `streak` tag counts the days in a row the player has played, this one included.
A run claiming N > 1 only counts as a streak if the player's run for the day before, on
relay.silvamor.com, claims N − 1; otherwise it shows as a first day. relay.silvamor.com checks the
same link when it takes a run, so a streak is a chain of such links, each checked when it was made.
Each check needs only the day before, so runs deleted after 30 days don't break a streak. A missing
or unreadable `streak` tag (runs from before streaks) counts as 1. Clients claim one more than the
largest streak on their own runs for the day before.

**Beating a friend.** The run's `p` tags list the people the player follows whose counted run that
day scored lower when the run was published. A tagged player's client tells them only when the
author is someone they follow, the run is valid, and it beats their own counted run that day.

## Groups

Groups are standard NIP-51 follow sets (kind `30000`), so other Nostr apps can show them too:
`["d", id]`, `["title", name]` and one `["p", pubkey]` tag per member. Each group gets its own
Daily Deal leaderboard. When reading, members that other apps stored as NIP-51 private items
(encrypted `content`) are merged in.
- **Deleting:** a NIP-09 deletion request (kind 5 with an `a` tag) plus a replacement with a
  `["deleted"]` tag for relays that ignore deletions.

## Sprites

Each player picks an animated sprite: it cheers them on during their run and stands on the
leaderboard podium. The sheet format, the sprite event (kind 30951) and the choice event
(kind 30078) are specified in [SPRITES.md](SPRITES.md).
