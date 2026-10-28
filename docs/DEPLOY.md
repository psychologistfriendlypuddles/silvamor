# Deploying Silvamor

Silvamor is a static site: `npm run build` produces `dist/`, which any web server can serve. There
is no game server; the only optional backend is the push service for streak reminders. The setup below
assumes Nginx Proxy Manager (NPM) in front of a small nginx that serves `dist/`.

## 1. Build

```sh
npm ci
VITE_PUSH_URL=https://push.silvamor.com \
VITE_SPRITE_CURATORS=npub1… \
npm run build          # → dist/
```

Every setting is optional; see "Build-time settings" in the [README](../README.md#build-time-settings)
(relays, Bitcoin block sources, push service, Blossom server, sprite curators). Settings are
baked in at build time, so rebuild after changing them. Then copy the *contents* of `dist/` to the
web root.

## 2. Nginx Proxy Manager (proxy host for www.silvamor.com)

On the **Details** and **SSL** tabs:

| Setting                | Value | Why |
|------------------------|-------|-----|
| Websockets Support     | off is fine | The app's own site doesn't use websockets. Turn it **on** for the relay's proxy host (relay.silvamor.com): relays are websockets. |
| Force SSL              | on    | Browsers only install PWAs and allow service workers, push and the clipboard on HTTPS. |
| HTTP/2 Support         | on    | Faster loading of the app's many small files. |
| HSTS Enabled           | on    | Browsers will refuse plain HTTP for your domain from then on. |

Those settings secure the *connection*. The security headers below are different: they tell the
browser what the *page itself* may do. That matters because the page can hold a Nostr key, so
even an injected script or a compromised dependency is limited in where it can send data.

## 3. The web server that serves `dist/`

Two files for an nginx container (e.g. `nginx:alpine`) whose web root holds the contents of `dist/`.
NPM then proxies www.silvamor.com to it.

**`/etc/nginx/snippets/silvamor-security.conf`**: the security headers. They must match
`deploy/security-headers.ts`, which the end-to-end tests run under; `src/lib/deploy.test.ts` fails
if this block drifts.

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self'; connect-src 'self' https: wss:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

The policy lets the app talk to any HTTPS or WSS address, because players choose their own relays,
Lightning wallets, Blossom servers and push service. It doesn't allow scripts from anywhere but
the site itself.

**`/etc/nginx/conf.d/default.conf`**: the site. nginx forgets server-level headers inside any
`location` that sets its own `add_header`, so every block includes the snippet.

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    include /etc/nginx/snippets/silvamor-security.conf;

    # Single-page app: unknown paths (e.g. /reminders) load the app.
    location / {
        try_files $uri /index.html;
    }

    # Hashed build files never change: cache them for a year.
    location /assets/ {
        include /etc/nginx/snippets/silvamor-security.conf;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # The service worker and app shell must always be revalidated so updates reach players.
    location ~ ^/(sw\.js|index\.html|manifest\.webmanifest)$ {
        include /etc/nginx/snippets/silvamor-security.conf;
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }
}
```

## 4. Relays

relay.silvamor.com is Silvamor's **home relay** (`HOME_RELAY` in `src/lib/nostr/pool.ts`; change it
with `VITE_HOME_RELAY`). Every Silvamor event goes there whatever relays a player picks: runs,
leagues, sprites, sprite choices, reports, featured picks, tip receipts, profiles and relay lists.
On login the app also copies the player's own latest profile, follow list and relay list there
(they're already signed, so no new signature). So the home relay holds everything leaderboards and
streak reminders need without asking other relays. Players still choose their own relays on the
Relays page; those are used as well, and the page shows the home relay as always on. Signer apps
never use it (see `NIP46_RELAYS`).

To open it to everyone without it filling up with unrelated notes, run it with
[`deploy/compose.yaml`](../deploy/compose.yaml): nostr-rs-relay with the
[relay guard](../guard/README.md) beside it, configured from
[`deploy/nostr-rs-relay.toml`](../deploy/nostr-rs-relay.toml). Both restart unless stopped, and
the guard has a Docker health check.

| Layer | What it does |
|-------|--------------|
| Remove the pubkey whitelist | Every player can publish |
| Event-kind allowlist (relay config) | Only Silvamor's 12 kinds are stored: 0, 3, 5, 62, 1953, 1984, 9735, 10002, 30000, 30004, 30078, 30951. Notes, reactions, DMs and the rest are refused |
| Size and time limits (relay config) | Events over 256 KB (room for follow lists of about 3,500 people), or dated more than 30 minutes ahead, are refused |
| `limit_scrapers` (relay config) | Vague "give me everything" queries are refused; every query Silvamor makes is narrow enough |
| Relay guard: admission | Each kind gets a size cap and a shape check, so junk of an allowed kind is refused too: runs must arrive as they're made and replay to their score, reports must be about a sprite (notes at most 83 characters, 1 KB in all), settings must be Silvamor's own, sprites must be valid, and so on |
| Relay guard: rate limits | 60 events a minute and 2,000 a day per IP address, however many keys it uses; none per key, since anyone can resend a key's events (the relay reads each player's real address from the proxy's `X-Real-IP` header) |
| Relay guard: clean-up | Deletes runs and tip receipts after 30 days, as the privacy policy promises; keeps sprite reports |
| Relay guard: requests to vanish | "Delete my data" on the Profile page sends a NIP-62 request naming this relay; the guard deletes everything that key published here and refuses those events if they're uploaded again |
| Relay guard: sweep | Every minute, checks the runs stored in the last two hours again (all of them after it starts) and deletes the ones it would have refused, such as runs stored while it was down |

Check the option names against the sample `config.toml` of the nostr-rs-relay version you run.
If the guard is down, the relay admits events but still applies its allowlist: nothing is lost, and
the runs it stored meanwhile are checked by the guard's sweep a minute after it's back.
Replaceable events (profiles, follow lists, relay lists, leagues, sprites) need no clean-up: the
relay keeps only the newest of each. Runs are about 2 KB, so without clean-up 10,000 players a day
add about 7 GB a year.

## 5. Push service (optional)

Streak reminders come from the push service in `push/` (see
[push/README.md](../push/README.md)): run it (Docker image or `npm run push:start`) and give it its
own proxy host in Nginx Proxy Manager, e.g. `push.silvamor.com` with Force SSL. Build the app with
`VITE_PUSH_URL=https://push.silvamor.com` so players get it by default (they can pick another one
on the Reminders page). Keep its data directory: losing `vapid.json` invalidates every subscription.

## 6. Sprite shop curators (optional)

The sprite shop's **Featured** shelf shows sprites picked (⭐) by people each player follows, plus
the curators set at build time: `VITE_SPRITE_CURATORS=npub1…,npub1…`. Each curator just taps
⭐ Feature on sprites in the shop while logged in; their picks are a public NIP-51 list.

## 7. Check it

- `/terms` and `/privacy` open without logging in, and their Nostr contact (`CONTACT_NPUB` in
  `src/pages/Legal.tsx`) is an account you read.

- `curl -I https://www.silvamor.com/` and `curl -I https://www.silvamor.com/sw.js` both show the
  `Content-Security-Policy` header, and `sw.js` shows `Cache-Control: no-cache`.
- `curl -I https://www.silvamor.com/notifications` returns 200 (the app, not a 404).
- `npm run e2e` runs the whole app under exactly this policy, so if the tests pass, the policy
  doesn't break the app.
- On a phone, "Add to Home Screen" / "Install app" should appear.
- The relay's startup log says `connected to nostr authorization GRPC server` and does **not** say
  `Default configuration settings will be used`. If it does, the relay couldn't read `config.toml`
  and is running wide open (no allowlist, no guard); on SELinux hosts that's a missing `z` on the
  mount (`deploy/compose.yaml` has it).
- `docker compose -f deploy/compose.yaml ps` shows the guard as healthy, and its log shows a
  `cleanup` line and a `sweep` line a minute after it starts.
- The privacy policy promises relay.silvamor.com keeps connection records (IP addresses) for no more
  than 30 days. nostr-rs-relay writes them to its log, so make sure that log is gone within 30 days:
  with Docker's default `json-file` driver, logs live until the container is removed, so switch the
  relay container to `--log-driver journald` with journald's `MaxRetentionSec=30day`, or rotate
  and delete the log files on a 30-day schedule.
- With the push service: `curl https://push.silvamor.com/health` answers, and turning on
  "Notify me when Silvamor is closed" on the Alerts page succeeds.
