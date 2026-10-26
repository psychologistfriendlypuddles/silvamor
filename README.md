# Silvamor

*Play games on Nostr.*

A playful game lobby on the [Nostr protocol](https://github.com/nostr-protocol/nips), shipped as a
Progressive Web App (no app stores). Players log in with their Nostr key, find or create games, and
play each other. Every move is a signed Nostr event that any client can check, so there is no game
server.

## Features

**Games**
- Tic-Tac-Toe, Four-in-a-Row, Dots and Boxes, Chess, Reversi, Checkers, Go, Gomoku and Nine Men's Morris
- Hash-chained, replay-validated moves: every client checks every move, so cheating moves are ignored
- Turn clocks in Bitcoin blocks (1 to 432 blocks per turn, or none): run out of time for a strike,
  three strikes and you lose. What a strike does depends on the game (dots and boxes passes the turn)
- A Rules sheet in every game: how to play, its turn clock and its wager terms
- Spectating, and a replay player for finished games (step, scrub, autoplay)

**Lobby and friends**
- Live lobby (open / live / my games) and a create-game dialog: anyone, invite link (single use),
  invite only, or a group
- Groups: named sets of friends (public NIP-51 follow sets) to start games only they can join
- In-game chat between the players (NIP-22 comments)
- Thank-you tips: after a game, players (and spectators) can send a flat 21-sat tip; any player can be
  tipped any amount from their profile. Never before or during a game, and never tied to the result
- Notifications while the app is open (your turn, joined, invited, strikes, one block before a strike,
  game over, chat), and push notifications when it's closed through a self-hostable push service
  ([push/](push/README.md))

**Friendly wagers (off by default)**
- Built but switched off: betting on games is restricted in many places. See
  [docs/DEPLOY.md](docs/DEPLOY.md#7-wagers-and-honor-badges-off-by-default) before turning them on
- An optional stake on any game, 1 sat to 1 BTC, on the honor system: nobody holds the money
- The loser pays the winner with a zap from a connected wallet (Nostr Wallet Connect), a browser
  wallet (WebLN) or a QR code; the zap receipt proves it
- Honor badges on every profile picture, worked out by each client from games and zap receipts:
  red (owes a wager), new, bronze, silver, gold (paid wagers to 1, 10, 25 different players)

**Sprites**
- Animated player sprites that stand in each player's corner and react to the game (moods, strikes,
  captures, check, chat), with a starter ostrich and an open sprite sheet standard
  ([docs/SPRITES.md](docs/SPRITES.md))
- Sprite shop: every sprite is free to share and use; players can tip artists they like with a zap,
  straight to the artist (no fee)
- Moderation without a moderator: hide artists, report sprites (NIP-56; reports from 3+ people you
  follow blur a sprite), and a Featured shelf of ⭐ picks from curators and people you follow

**Accounts and relays**
- Log in with a NIP-07 browser extension, a NIP-46 signer app (QR `nostrconnect://` or `bunker://`),
  or a pasted nsec (kept in memory, or remembered on the device only as a NIP-49
  password-encrypted `ncryptsec`), or create a new key
- Profile page: kind 0 metadata, live NIP-05 verification, Lightning address, Blossom picture upload
- Relays page: NIP-65 relay list (kind 10002) with read/write markers, NIP-11 info, live status
- Installable PWA with an offline app shell

Player ratings (head-to-head record with the unique-opponent rule, and reliability) are built but
hidden for now (`FEATURES.ratings` in `src/features.ts`).

## Documentation

- [docs/PROTOCOL.md](docs/PROTOCOL.md): the open game protocol (events, replay, turn clock, wagers)
- [docs/SPRITES.md](docs/SPRITES.md): the sprite sheet standard, tips and moderation
- [docs/DEPLOY.md](docs/DEPLOY.md): hosting the app (and the optional push service)
- [push/README.md](push/README.md): the push notification service
- Terms of use and privacy policy: in the app at `/terms` and `/privacy` (`src/pages/Legal.tsx`)

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build (service worker active)
npm run lint
npm test           # unit tests (rules, replay, protocol, wagers, sprites, moderation…)
npm run e2e        # end-to-end tests with several browsers (system Chromium, about five minutes)
npm run push:build # build the push service (push/dist/server.mjs); npm run push:start runs it
npm run stats      # games per day and the most popular games, from the public relays
```

To develop without touching public relays, run the bundled in-memory relay and point the app at it.
It also fakes a Bitcoin block height (`POST /mine?blocks=N` mines blocks), a Lightning provider
(`<name>@localhost:7777` is a zappable Lightning address) and a Blossom server:

```sh
npm run relay                              # ws://localhost:7777
VITE_RELAYS=ws://localhost:7777 VITE_BLOCK_SOURCES=http://localhost:7777/api/blocks/tip/height npm run dev
```

Open two browser profiles (or one normal and one private window) to play yourself.

To try push notifications before deploying (desktop browser, since `localhost` counts as secure;
`npm run dev` has no service worker, so use a production build):

```sh
npm run push:build && APP_URL=http://localhost:4173 npm run push:start   # push service on :8787
VITE_PUSH_URL=http://localhost:8787 npm run build && npm run preview     # app on :4173
```

Then turn on "Notify me when Silvamor is closed" on the Alerts page.

### Build-time settings

All optional; set them when running `npm run build` (or `npm run dev`).

| Variable | Default | What it does |
|----------|---------|--------------|
| `VITE_RELAYS` | relay.silvamor.com, relay.damus.io, nos.lol, relay.primal.net | Comma-separated relays replacing every default (lobby, profiles, signer apps) |
| `VITE_BLOCK_SOURCES` | mempool.space, blockstream.info | URLs returning the Bitcoin tip height as text; the lowest answer is used |
| `VITE_PUSH_URL` | none | The push service players get by default |
| `VITE_BLOSSOM_SERVER` | blossom.primal.net | Where profile pictures and sprite sheets are uploaded |
| `VITE_SPRITE_CURATORS` | none | Comma-separated npubs whose ⭐ picks fill the sprite shop's Featured shelf |
| `VITE_ENABLE_WAGERS` | off | `true` turns on friendly wagers and honor badges; read [docs/DEPLOY.md](docs/DEPLOY.md#7-wagers-and-honor-badges-off-by-default) first |

### Game stats

`npm run stats` counts Silvamor games started in the last 30 days (UTC), straight from the public
relays: nothing to deploy, and your own relay doesn't need to store anything. Only games that really
started count (the listing must point at a start action signed by its host).

```sh
npm run stats                  # last 30 days
npm run stats -- --days 7      # last 7 days
npm run stats -- --json        # for a spreadsheet or chart
npm run stats -- --relays wss://relay.damus.io,wss://nos.lol
```

Relays may drop old events, so it's reliable for recent weeks rather than all time. Save the
`--json` output now and then if you want a longer history.

## Deploying

`dist/` is a static site. See [docs/DEPLOY.md](docs/DEPLOY.md) for Nginx Proxy Manager settings and
the nginx config, including the security headers the end-to-end tests verify.

## Layout

```
src/
  games/         rules and boards, one folder per game; registry, rules text, shared boards
  lib/           replay engine, wagers & payments, sprites, moderation, notifications, Bitcoin height
  lib/nostr/     relay pool, signers (NIP-07/46/local), game events, profiles, groups, chat
  hooks/         useGame (one game), useHostAgent (admits joiners), useGameWatcher (notifications)
  stores/        zustand stores: session, relays, profiles, lobby, groups, honor, sprites, moderation…
  components/    layout, UI kit, player cards, sprites, wagers, dialogs
  pages/         Login, Unlock, Lobby, Game, Groups, Sprites shop, Notifications, Relays, Profile
  sw.ts          service worker (offline shell, push)
push/            the self-hostable push notification service
scripts/         dev relay (with fake block height, Lightning and Blossom), sprite generator, game stats
tests/e2e/       Playwright end-to-end tests
deploy/          security headers shared by preview, tests and docs/DEPLOY.md
public/sprites/  the starter ostrich sheet and the blank template for artists
```

## License

[GPL-3.0](LICENSE)
