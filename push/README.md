# Silvamor push service

A small, self-hostable watchtower for streak reminders. Players who turn reminders on register
their browser's push subscription here, signed with their Nostr key (NIP-98, no accounts). A few
hours before the day ends (midnight UTC), the service reads subscribers' Block of the Day runs from
Silvamor's relay and sends one Web Push notification to each player whose streak reached
yesterday and who hasn't played today: "🔥 Your 12-day streak ends in 4 hours. Play today to keep
it going." Silvamor's relay checks every run's streak before keeping it, so the service takes the
streak as it is.

It only learns what is already public on the relay, plus where to deliver pushes.

## Run it

```sh
npm run push:build                       # → push/dist/server.mjs (self-contained)
APP_URL=https://www.silvamor.com \
PUBLIC_URL=https://push.silvamor.com \
VAPID_SUBJECT=mailto:you@example.com \
npm run push:start
```

Or with Docker (from the repository root):

```sh
docker build -f push/Dockerfile -t silvamor-push .
docker run -d --name silvamor-push -p 8787:8787 -v silvamor-push:/data \
  -e APP_URL=https://www.silvamor.com -e PUBLIC_URL=https://push.silvamor.com \
  -e VAPID_SUBJECT=mailto:you@example.com silvamor-push
```

Put it behind your reverse proxy with HTTPS (e.g. Nginx Proxy Manager → `push.silvamor.com`).
Browsers only allow push from apps served over HTTPS, and the app's security policy only lets it
call HTTPS services.

## Settings (environment variables)

| Variable | Default | What it's for |
|----------|---------|---------------|
| `PORT` | `8787` | Port to listen on |
| `PUBLIC_URL` | `http://localhost:8787` | This service's public address, exactly as the app calls it. Signed requests name this URL, so it must match. |
| `APP_URL` | `http://localhost:4173` | Where the app lives; notification links point here |
| `ALLOWED_ORIGINS` | `APP_URL` | Comma-separated origins allowed to call the service (`*` for any) |
| `RELAYS` | `wss://relay.silvamor.com` | Comma-separated relays to read runs from. Streaks are only checked on Silvamor's relay. |
| `REMIND_HOURS_BEFORE` | `4` | How long before the day ends (midnight UTC) to remind |
| `DATA_DIR` | `./push-data` (`/data` in Docker) | Where `push.sqlite` and `vapid.json` live. Keep it: losing `vapid.json` invalidates every subscription. |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact the push services can reach you at |

## API

| Method | Path | |
|--------|------|-|
| `GET` | `/vapid-public-key` | The key browsers subscribe with |
| `POST` | `/subscriptions` | Body `{ "subscription": PushSubscriptionJSON }`, NIP-98 signed |
| `DELETE` | `/subscriptions` | Body `{ "endpoint": "…" }`, NIP-98 signed; only your own |
| `GET` | `/health` | `{ ok, subscribers }` |

Each player gets at most one reminder a day, and none once they've played. Expired subscriptions
are removed.
