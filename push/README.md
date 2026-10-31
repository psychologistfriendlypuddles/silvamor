# Silvamor push service

A small, self-hostable watchtower for streak reminders. Players who turn reminders on register
their browser's push subscription here, signed with their Nostr key (NIP-98, no accounts). A few
hours before the day ends (midnight UTC), the service reads subscribers' Block of the Day runs from
Silvamor's relay and sends one Web Push notification to each player whose streak reached
yesterday and who hasn't played today: "🔥 Your 12-day streak ends in 4 hours. Play today to keep
it going." Silvamor's relay checks every run's streak before keeping it, so the service takes the
streak as it is.

It only learns what is already public on the relay, plus where to deliver pushes. And it only keeps
players: signing up needs a game on the relay from the last 30 days, and a key that goes 30 days
without one is let go, browsers and all (the app signs a browser up again after its next game).

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
docker build --pull -f push/Dockerfile -t silvamor-push .
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
| `RELAYS` | `wss://relay.silvamor.com` | Comma-separated relays to read runs from. Nothing is decided on one's silence, so a relay that never answers holds reminders up. Streaks are only checked on Silvamor's relay. |
| `REMIND_HOURS_BEFORE` | `4` | How long before the day ends (midnight UTC) to remind |
| `DATA_DIR` | `./push-data` (`/data` in Docker) | Where `push.sqlite` and `vapid.json` live. Keep it: losing `vapid.json` invalidates every subscription. |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact the push services can reach you at |
| `PUSH_HOSTS` | `fcm.googleapis.com,android.googleapis.com,push.services.mozilla.com,push.apple.com,notify.windows.com` | The browser push services subscriptions may point at (each with its subdomains): Chrome and other Chromium browsers, Firefox, Safari and Edge. Others are refused, so the service never posts anywhere else. |

## API

| Method | Path | |
|--------|------|-|
| `GET` | `/vapid-public-key` | The key browsers subscribe with |
| `POST` | `/subscriptions` | Body `{ "subscription": PushSubscriptionJSON }`, NIP-98 signed; only for keys with a game from the last 30 days (`403` otherwise, `503` if the relay doesn't answer) |
| `POST` | `/subscriptions/check` | Body `{ "endpoint": "…" }`: `{ "subscribed": true \| false }`, whether that browser is still signed up |
| `DELETE` | `/subscriptions` | Body `{ "endpoint": "…" }`, NIP-98 signed; only your own |
| `GET` | `/health` | `{ ok, subscribers }` |

Each player gets at most one reminder a day, and none once they've played. While reminders are
going out, each player is looked up again 2 hours after the relay last answered for them, or at the
next round (every 5 minutes) if it didn't. Expired subscriptions are removed. A key keeps reminders
on its 5 newest browsers; subscribing a sixth drops the oldest. Reminders go out to several players
at once, and a push service that doesn't answer within 15 seconds counts as a failed push, so it
can't hold up anyone else's.
