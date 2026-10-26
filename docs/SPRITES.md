# Silvamor sprite standard (v1)

A sprite is the little character that stands in a player's corner of every game and reacts to how
it's going. Anyone can draw one: it's a single PNG sheet plus a short JSON manifest, published on
Nostr so every client shows the same sprite.

Start from the [template sheet](../public/sprites/template.png) (128 px frames, labelled rows) or
look at the starter [ostrich](../public/sprites/ostrich.png) (64 px pixel art, drawn by
`scripts/sprites/ostrich.mjs`). In the template, the alternating boxes are the frames, the vertical
line is each frame's centre and the horizontal line is the feet line. They and the row labels are
guides only: hide them before exporting, so the finished sheet has a transparent background.

## The sheet

- **PNG** with a transparent background, at most **1 MB**.
- Frames are **square**, `size` pixels a side, from **32 to 256**.
- **One row per animation**, frames left to right, up to **16 frames** per row. The sheet is as
  wide as the longest row and as tall as the last row used; extra space is ignored.
- Draw the character **facing right**. The right-hand player's sprite is mirrored to face the board.
- Keep the feet on the same line in every frame (the template's pink line, about 92% down) and the
  character roughly centred, so mirroring and swapping animations don't make it jump.
- Leave a little room around the character for effects (thought bubbles, sparkles, lightning…).
  Sprites are shown from 56 to 160 px, so bold shapes and outlines read best.

## The animations

| Name       | Kind     | Plays when                                   | If missing        |
|------------|----------|----------------------------------------------|-------------------|
| `idle`     | mood     | Nothing in particular is happening           | **required**      |
| `thinking` | mood     | It's this player's turn                      | idle              |
| `happy`    | mood     | This player just moved                       | idle              |
| `sad`      | mood     | (reserved: things going badly)               | idle              |
| `win`      | mood     | This player won                              | happy, then idle  |
| `lose`     | mood     | This player lost                             | sad, then idle    |
| `draw`     | mood     | The game was drawn                           | idle              |
| `strike`   | one-shot | This player got a turn-clock strike          | skipped           |
| `capture`  | one-shot | This player took a piece or stones (chess, checkers, Go, morris) or a box (dots and boxes) | skipped |
| `check`    | one-shot | This player's king was put in check          | skipped           |
| `chat`     | one-shot | This player sent a chat message              | skipped           |

Moods loop. One-shots play once, then the current mood resumes. Players who prefer reduced motion
see the first frame of each mood.

## The manifest

```json
{
  "version": 1,
  "size": 64,
  "pixelated": true,
  "animations": {
    "idle":     { "row": 0, "frames": 4, "fps": 4 },
    "thinking": { "row": 1, "frames": 4, "fps": 4 },
    "win":      { "row": 4, "frames": 6, "fps": 10 },
    "strike":   { "row": 7, "frames": 6, "fps": 10 }
  }
}
```

- `size`: frame size in pixels.
- `pixelated`: `true` scales the sheet up with hard edges (pixel art); otherwise it's smoothed.
- `animations`: any of the names above, each with its `row` (0-based), `frames` (1–16) and `fps`
  (1–30). Rows can be in any order but can't be shared. Unknown names are rejected.

## On Nostr

**Sprite** (kind 30951, addressable, by the artist). The sheet is hosted on a Blossom server
(https only); `x` is its sha256, so clients can check or find another copy.

```jsonc
{
  "kind": 30951,
  "content": "<the manifest JSON>",
  "tags": [
    ["d", "<id>"],
    ["title", "Disco duck"],
    ["image", "https://blossom.example/<sha256>.png"],
    ["x", "<sha256>"],
    ["m", "image/png"],
    ["t", "silvamor"],
    ["alt", "Silvamor player sprite: Disco duck"]
  ]
}
```

**Choice** (kind 30078, NIP-78 app data, by the player): `["d", "silvamor/sprite"]` plus either
`["a", "30951:<artist>:<d>"]` for a published sprite or `["sprite", "builtin:ostrich"]` for one
that ships with the app. Without a choice, players show the default (the ostrich).

Clients show a sprite only if its manifest is valid and the sheet loads at least as large as the
manifest needs; otherwise they fall back to the default.

## Tipping artists

Every sprite is free to use; nothing is sold and there are no licences. Players who like a sprite
can tip its artist: a NIP-57 zap to the artist with a zap request carrying
`["a", "30951:<artist>:<d>"]` and `["k", "30951"]`, paid straight from the player's wallet to the
artist's Lightning address. Silvamor takes no cut and the tip unlocks nothing.

The sprite shop lists every kind 30951 event tagged `silvamor`. Sheets are public pictures, so
anyone can copy one; when several authors publish the same sheet (same `x`), the shop lists only
the earliest. Sprite events from before tips may carry a `price` tag; clients ignore it.

## Moderation and curation

Nobody runs the shop, so each player's app decides what they see:

- **Hide an artist.** Their sprites leave your shop and show as the default sprite on players. The
  list lives in your private Silvamor settings: a NIP-78 event (kind 30078,
  `d=silvamor/moderation`) whose content is NIP-44 encrypted to yourself, so it follows you to
  other devices without anyone seeing it. People on your NIP-51 mute list (kind 10000) are hidden
  too.
- **Report a sprite.** A NIP-56 report (kind 1984) with `["p", <artist>, <reason>]`,
  `["a", <sprite address>, <reason>]` and `["k", "30951"]`. A sprite you reported is hidden for you.
  When **3 or more people you follow** report a sprite, your app blurs it in the shop and shows the
  default sprite instead of it on players. This is on by default and can be turned off under
  "Shop safety". Reports from strangers don't count, so nobody can mass-report a sprite away.
- **Feature a sprite.** ⭐ adds it to your picks: a NIP-51 curation set (kind 30004,
  `d=silvamor-sprites`, one `a` tag per sprite). The shop's **Featured** shelf shows picks from the
  people you follow and from the app's curators (`VITE_SPRITE_CURATORS`), ranked by how many picked
  each.
