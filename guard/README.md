# Silvamor relay guard

A small companion to relay.silvamor.com (nostr-rs-relay). It does these jobs:

- **Event admission.** The relay asks it about every incoming event (gRPC, nostr-rs-relay's
  `nauthz` API) before storing it. It admits only Silvamor's event kinds, and gives each a size
  cap and a shape check (`src/policy.ts`), so junk of an allowed kind is refused too. For example:
  Block of the Day runs must replay on the day's transactions to the fees they claim (the app's own
  check, `../src/lib/nostr/minerRuns.ts`), and a run claiming an N-day streak needs the player's run
  for the day before, stored here, to claim N − 1 (the guard reads it from the relay's database;
  [docs/PROTOCOL.md](../docs/PROTOCOL.md), "Streaks"). Runs also have to
  stay under 8 KB; reports must be about a sprite, with a
  note of at most 83 characters and 1 KB in all (reports are kept for good); kind-30078 settings
  must be Silvamor's own (`d` tag starting `silvamor/`); sprites must be valid Silvamor sprites.
  Follow lists come from any Nostr app and can be long, so they only get a 256 KB cap.
- **Rate limits.** Each author may publish 30 events a minute. Each IP address may publish 60 a
  minute and 2,000 a day, however many keys it uses, so throwaway keys can't get around the
  per-author limit: one machine can add at most a few MB a day. The limits are generous because
  many players can share one address (a school, an office, a mobile network). For the address to
  be the player's and not the proxy's, the relay needs `remote_ip_header` (see
  [deploy/nostr-rs-relay.toml](../deploy/nostr-rs-relay.toml)) and must be reachable only through
  the proxy, or a client could fake the header.
- **Clean-up.** nostr-rs-relay never deletes old events. Once a day the guard deletes events
  older than the privacy policy allows (runs and tip receipts after 30 days) straight from
  the relay's SQLite file. Sprite reports are kept, so moderation keeps working.
- **Requests to vanish.** "Delete my data" on the Profile page publishes a NIP-62 request to vanish
  naming this relay (`RELAY_URL`). Before the relay stores it, the guard deletes every event that
  key published here, then refuses any of them uploaded again (anything dated before the
  request), so a copy from another relay can't bring them back. The request itself is kept: it's
  how the guard remembers, and it holds only the key and the time. This happens even with
  `DRY_RUN=true`, because the player asked for it. Without `RELAY_DB` the guard refuses requests
  to vanish, so the player is told nothing was deleted.

If the guard is down, the relay admits events (still only the kinds its own allowlist accepts),
so an outage loosens the rules but loses nothing. If no Bitcoin block source answers, runs are
admitted unchecked for the same reason; clients check every run anyway.

## Run it

```sh
npm run guard:build                      # → guard/dist/server.mjs (self-contained)
RELAY_DB=/path/to/nostr.db npm run guard:start
```

In production, run it beside the relay with [deploy/compose.yaml](../deploy/compose.yaml), from the
repository root:

```sh
cp deploy/nostr-rs-relay.toml deploy/config.toml   # then merge in your own [info] and other settings
docker compose -f deploy/compose.yaml up -d --build
```

- Both containers restart unless stopped. The guard has a Docker health check (a real admission
  request every 30 seconds), and the relay only starts once the guard is healthy.
- The guard runs as the relay image's `appuser` (`1000:1000`) and shares its data volume, so it
  can delete from the database.
- The guard publishes no ports: the relay reaches it as `http://guard:50051` on the compose
  network, and nothing else can.
- Start with `DRY_RUN=true`: the log shows how many events clean-up *would* delete
  (`cleanup (dry run, nothing deleted): kind 1952: 0, kind 1953: 0, kind 9735: 0`). When the numbers look right,
  set `DRY_RUN=false`. Back up `nostr.db` first.

## Settings (environment variables)

| Variable | Default | What it's for |
|----------|---------|---------------|
| `LISTEN` | `0.0.0.0:50051` | Address the relay connects to |
| `BLOCK_SOURCES` | mempool.space, blockstream.info | Bitcoin block sources (Esplora API), to find each day's seed block and check runs |
| `PER_MINUTE` | `30` | Events one author may publish per minute |
| `PER_IP_MINUTE` | `60` | Events one IP address may publish per minute, whatever keys it uses |
| `PER_IP_DAY` | `2000` | Events one IP address may publish per day, whatever keys it uses |
| `RELAY_URL` | `wss://relay.silvamor.com` | This relay's address, which requests to vanish must name (or `ALL_RELAYS`) |
| `RELAY_DB` | none | The relay's SQLite file. Without it, there's no clean-up and no requests to vanish |
| `RETENTION` | `1952:30,1953:30,9735:30` | What to delete, as `kind:days` pairs: by default runs and tip receipts after 30 days, as the privacy policy promises (1952 clears the last runs of the retired Daily Deal). Change it only together with the policy |
| `DRY_RUN` | `true` | `false` to actually delete; otherwise clean-up only counts |

Clean-up runs a minute after start and then every 24 hours. It's written against nostr-rs-relay's
SQLite schema (database version 18) and refuses older databases. It doesn't work with the relay's
experimental Postgres engine. Profiles, follow lists and other replaceable events need no
clean-up: the relay keeps only the newest of each.
