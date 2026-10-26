# Deploying Silvamor

Silvamor is a static site: `npm run build` produces `dist/`, which any web server can serve. There
is no game server; the only optional backend is the push notification service. The setup below
assumes Nginx Proxy Manager (NPM) in front of a small nginx that serves `dist/`.

## 1. Build

```sh
npm ci
VITE_PUSH_URL=https://push.silvamor.com \
VITE_SPRITE_CURATORS=npub1… \
npm run build          # → dist/
```

Every setting is optional; see "Build-time settings" in the [README](../README.md#build-time-settings)
(relays, Bitcoin block-height sources, push service, Blossom server, sprite curators, wagers). Settings are
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

    # Single-page app: unknown paths (e.g. /game/naddr1…) load the app.
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

Games are published to the player's own write relays plus Silvamor's defaults
(relay.silvamor.com, relay.damus.io, nos.lol, relay.primal.net), and read from all of them. If
relay.silvamor.com only accepts events from a whitelist, other players' games simply don't land
there, but still reach the public relays, so nothing breaks; open it up (or add a paid or
web-of-trust policy) when you want it to carry everyone's games. Signer apps never use it (see
`NIP46_RELAYS` in `src/lib/nostr/pool.ts`).

## 5. Push service (optional)

Push notifications when the app is closed come from the push service in `push/` (see
[push/README.md](../push/README.md)): run it (Docker image or `npm run push:start`) and give it its
own proxy host in Nginx Proxy Manager, e.g. `push.silvamor.com` with Force SSL. Build the app with
`VITE_PUSH_URL=https://push.silvamor.com` so players get it by default (they can pick another one
on the Alerts page). Keep its data directory: losing `vapid.json` invalidates every subscription.

## 6. Sprite shop curators (optional)

The sprite shop's **Featured** shelf shows sprites picked (⭐) by people each player follows, plus
the curators set at build time: `VITE_SPRITE_CURATORS=npub1…,npub1…`. Each curator just taps
⭐ Feature on sprites in the shop while logged in; their picks are a public NIP-51 list.

## 7. Wagers and honor badges (off by default)

Friendly wagers and the wager honor badges are built but **switched off**, because betting money on
games, even games of skill between friends, is restricted or illegal in many places (including
many US states). Only turn them on if you've confirmed with a lawyer that it's lawful where you
operate and for your players.

While they're off (the default), Silvamor:
- doesn't offer the Wager option when creating a game;
- leaves other clients' wager games out of the lobby and won't join them;
- shows no honor badges, honor card or wager rules;
- shows terms of use with a "No betting" section instead of the wager terms.

To turn them on, build with the flag (the terms, rules and warnings switch to the wager versions
by themselves):

```sh
VITE_ENABLE_WAGERS=true npm run build
```

It's a build-time setting, so it can't be switched on from a browser, and turning it off again is
a rebuild without it. Everything wagers need is still in the code (`FEATURES.wagers` in
`src/features.ts`), and the end-to-end tests run the wager tests against a second build with the
flag on, so the feature keeps working while it's off.

## 8. Check it

- `/terms` and `/privacy` open without logging in, and their Nostr contact (`CONTACT_NPUB` in
  `src/pages/Legal.tsx`) is an account you read.

- `curl -I https://www.silvamor.com/` and `curl -I https://www.silvamor.com/sw.js` both show the
  `Content-Security-Policy` header, and `sw.js` shows `Cache-Control: no-cache`.
- `curl -I https://www.silvamor.com/game/anything` returns 200 (the app, not a 404).
- `npm run e2e` runs the whole app under exactly this policy, so if the tests pass, the policy
  doesn't break the app.
- On a phone, "Add to Home Screen" / "Install app" should appear.
- With the push service: `curl https://push.silvamor.com/health` answers, and turning on
  "Notify me when Silvamor is closed" on the Alerts page succeeds.
