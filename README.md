# Silvamor

*Play games on Nostr.*

A playful home for games on the [Nostr protocol](https://github.com/nostr-protocol/nips), shipped
as a Progressive Web App (no app stores). Players log in with their Nostr key, play, and see how
their friends did. Every move is a signed Nostr event that any client can replay and check, so there
is no game server.

The first game is **Daily Deal**, a one-player card run where everyone gets the same deal each day.
More games are planned.

## Features

**Daily Deal** (the first game)
- A one-player poker-hands run: 8 cards in hand, 4 hands to play and 3 discards, plus three of the
  day's perks that boost certain hands
- Everyone gets the same deck and perks, shuffled by the first Bitcoin block after midnight UTC, so
  nobody can see the day's deal coming
- Your first run of the day is published to Nostr; every client replays it to check the score
- Leaderboards for the people you follow and for each of your groups, with a podium for the top
  three. Scores stay hidden until you've finished your own run
- Notifications when a friend beats your score: in the app, and as push notifications through a
  self-hostable push service ([push/](push/README.md))
- Tips: any player can be tipped any amount from their profile (tap them on the leaderboard)

**Sprites**
- Animated player sprites that cheer you on during your run and stand on the leaderboard podium,
  with a starter ostrich and an open sprite sheet standard ([docs/SPRITES.md](docs/SPRITES.md))
- Sprite shop: every sprite is free to share and use; players can tip artists they like with a zap,
  straight to the artist (no fee)
- Moderation without a moderator: hide artists, report sprites (NIP-56; reports from 3+ people you
  follow blur a sprite), and a Featured shelf of ⭐ picks from curators and people you follow

**Accounts and relays**
- Log in with a NIP-07 browser extension, a NIP-46 signer app (QR `nostrconnect://` or `bunker://`),
  or a pasted nsec (kept in memory, or remembered on the device only as a NIP-49
  password-encrypted `ncryptsec`), or create a new key
- Profile page: kind 0 metadata, live NIP-05 verification, Lightning address, Blossom picture upload
- Relays page: NIP-65 relay list (kind 10002) with read/write markers, NIP-11 info, live status;
  Silvamor's home relay is always used as well, and holds a copy of every player's Silvamor data
- Installable PWA with an offline app shell

The earlier two-player games (lobby, chess, Go and others, turn clocks, wagers, ratings) were
retired; their code is kept in git at the `multiplayer-archive` tag.

## Documentation

- [docs/PROTOCOL.md](docs/PROTOCOL.md): the open protocol (the day's deal, publishing runs, leaderboards)
- [docs/SPRITES.md](docs/SPRITES.md): the sprite sheet standard, tips and moderation
- [docs/DEPLOY.md](docs/DEPLOY.md): hosting the app (and the optional push service)
- [push/README.md](push/README.md): the push notification service
- [guard/README.md](guard/README.md): the relay guard (event admission and clean-up for relay.silvamor.com)
- Terms of use and privacy policy: in the app at `/terms` and `/privacy` (`src/pages/Legal.tsx`)

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build (service worker active)
npm run lint
npm test           # unit tests (rules, runs, push service, sprites, moderation…)
npm run e2e        # end-to-end tests with several browsers (system Chromium, a few minutes)
npm run push:build # build the push service (push/dist/server.mjs); npm run push:start runs it
npm run stats      # Daily Deal players per day, from the public relays
```

To develop without touching public relays, run the bundled in-memory relay and point the app at it.
It also fakes Bitcoin blocks (`POST /mine?blocks=N` mines blocks), a Lightning provider
(`<name>@localhost:7777` is a zappable Lightning address) and a Blossom server:

```sh
npm run relay                              # ws://localhost:7777
VITE_RELAYS=ws://localhost:7777 VITE_BLOCK_SOURCES=http://localhost:7777/api/blocks/tip/height npm run dev
```

Open two browser profiles (or one normal and one private window), following each other, to see
the leaderboard fill up.

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
| `VITE_RELAYS` | relay.silvamor.com, relay.damus.io, nos.lol, relay.primal.net | Comma-separated relays replacing every default (runs, profiles, signer apps) |
| `VITE_HOME_RELAY` | relay.silvamor.com (or the first of `VITE_RELAYS`) | Silvamor's own relay: every Silvamor event and each player's profile, follow list and relay list always go there ([docs/DEPLOY.md](docs/DEPLOY.md#4-relays)) |
| `VITE_BLOCK_SOURCES` | mempool.space, blockstream.info | URLs returning the Bitcoin tip height as text, with the Esplora block API (`…/blocks/<height>`) beside them; the day's seed block is looked up there |
| `VITE_PUSH_URL` | none | The push service players get by default |
| `VITE_BLOSSOM_SERVER` | blossom.primal.net | Where profile pictures and sprite sheets are uploaded |
| `VITE_COFFEE_ADDRESS` | silvamor@strike.me | Lightning address the "Buy me a coffee" button (sidebar, or the phone header) pays; empty hides the button |
| `VITE_SPRITE_CURATORS` | none | Comma-separated npubs whose ⭐ picks fill the sprite shop's Featured shelf |

### Stats

`npm run stats` counts Daily Deal players per day over the last 30 days (UTC), with each day's top
score, straight from the public relays: nothing to deploy. A player counts once a day, by their first
published run; scores are as claimed (the app replays them, this script doesn't).

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
  games/         one folder per game: rules, board and helpers (today: dailydeal/, with its seeded deal)
  lib/           tips & payments, sprites, moderation, notifications, Bitcoin blocks
  lib/nostr/     relay pool, signers (NIP-07/46/local), Daily Deal runs, profiles, groups
  hooks/         useDailyRuns (the day's runs), useDailyWatcher (notifications)
  stores/        zustand stores: session, relays, profiles, groups, sprites, moderation, notifications…
  components/    layout, UI kit, sprites, profiles, tips, dialogs
  pages/         Login, Unlock, Daily (home), Groups, Sprites shop, Notifications, Relays, Profile
  sw.ts          service worker (offline shell, push)
push/            the self-hostable push notification service
guard/           the relay guard for relay.silvamor.com (gRPC event admission, clean-up)
scripts/         dev relay (with fake Bitcoin blocks, Lightning and Blossom), sprite generator, stats
tests/e2e/       Playwright end-to-end tests
deploy/          security headers shared by preview, tests and docs/DEPLOY.md
public/sprites/  the starter ostrich sheet and the blank template for artists
```

## License

[GPL-3.0](LICENSE)
