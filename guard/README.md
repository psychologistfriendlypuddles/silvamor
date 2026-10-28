# Silvamor relay guard

A small companion to relay.silvamor.com (nostr-rs-relay). It does these jobs:

- **Event admission.** The relay asks it about every incoming event (gRPC, nostr-rs-relay's
  `nauthz` API) before storing it. It admits only Silvamor's event kinds, and gives each a size
  cap and a shape check (`src/policy.ts`), so junk of an allowed kind is refused too. For example:
  Block of the Day runs must replay on the day's transactions to the fees they claim (the app's own
  check, `../src/lib/nostr/minerRuns.ts`) and arrive as they're made (within 30 minutes, on their
  day or before 02:00 UTC the day after), so a past day can't be played later; a run claiming an
  N-day streak needs the player's run for the day before, stored here, to claim N − 1 (the guard
  reads it from the relay's database; [docs/PROTOCOL.md](../docs/PROTOCOL.md), "Streaks"). Runs also have to
  stay under 8 KB; reports must be about a sprite, with a
  note of at most 83 characters and 1 KB in all (reports are kept for good); kind-30078 settings
  must be Silvamor's own (`d` tag starting `silvamor/`); sprites must be valid Silvamor sprites.
  Follow lists come from any Nostr app and can be long, so they only get a 256 KB cap.
- **Rate limits.** Each IP address may publish 60 events a minute and 2,000 a day, however many
  keys it uses. There's no limit per key: a key's events are public, so anyone could send them
  again to use up the key's limit and lock its owner out. The limits are generous because many
  players can share one address (a school, an office, a mobile network). For the address to
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
- **Sweep.** While the guard can't be reached (restarting, say), the relay stores events unchecked.
  So every minute the guard checks the runs stored in the last two hours again, each as it reached
  the relay (its `first_seen` time), and deletes the ones it would have refused: made on another
  day, sent long after they were made, not replaying to their fees, or claiming a streak the day
  before doesn't back, which also catches the streaks that rested on a deleted run. The first sweep
  after the guard starts checks every stored run, which covers any time it was down and clears out
  runs from before this check existed. Runs whose day it can't read yet are left for the next sweep.

The boards take this relay's word for runs, so the guard refuses any run it can't check yet (no
Bitcoin block source answering, the day's block not mined yet, or a bug), and the app offers to
publish it again. Since the relay waits for every answer, each day's block and deal are read once,
one lookup at a time, and no run waits on that for more than 2.5 seconds. If the guard itself is
down, the relay admits events unchecked (still only the kinds its own allowlist accepts): nothing is
lost, and a run made up meanwhile stays on the boards only until the sweep a minute after the guard
is back.

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
  (`cleanup (dry run, nothing deleted): kind 1952: 0, kind 1953: 0, kind 9735: 0`), and which runs
  the sweep would (`sweep (dry run, nothing deleted): 120 runs checked, 0 failed`). When the numbers
  look right, set `DRY_RUN=false`. Back up `nostr.db` first.

## Settings (environment variables)

| Variable | Default | What it's for |
|----------|---------|---------------|
| `LISTEN` | `0.0.0.0:50051` | Address the relay connects to |
| `BLOCK_SOURCES` | mempool.space, blockstream.info | Bitcoin block sources (Esplora API), to find each day's seed block and check runs |
| `PER_IP_MINUTE` | `60` | Events one IP address may publish per minute, whatever keys it uses |
| `PER_IP_DAY` | `2000` | Events one IP address may publish per day, whatever keys it uses |
| `RELAY_URL` | `wss://relay.silvamor.com` | This relay's address, which requests to vanish must name (or `ALL_RELAYS`) |
| `RELAY_DB` | none | The relay's SQLite file. Without it, there's no clean-up, no sweep and no requests to vanish |
| `RETENTION` | `1952:30,1953:30,9735:30` | What to delete, as `kind:days` pairs: by default runs and tip receipts after 30 days, as the privacy policy promises (1952 clears the last runs of the retired Daily Deal). Change it only together with the policy |
| `DRY_RUN` | `true` | `false` to actually delete; otherwise clean-up and the sweep only count |

Clean-up runs a minute after start and then every 24 hours; the sweep, a minute after start and
then every minute. Both are written against nostr-rs-relay's SQLite schema (database version 18)
and refuse older databases. Neither works with the relay's
experimental Postgres engine. Profiles, follow lists and other replaceable events need no
clean-up: the relay keeps only the newest of each.
