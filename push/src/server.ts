import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'
import { unpackEventFromToken, validateEvent } from 'nostr-tools/nip98'
import { Store, type PushSubscriptionData } from './store'
import { createWatchtower, type PushPayload, type SendResult, type Watchtower } from './watchtower'

// Silvamor push service: a small, self-hostable watchtower. Players register a Web Push
// subscription by signing the request with their Nostr key (NIP-98); a few hours before the day
// ends, the service reminds those whose streak would end today.

export interface ServiceConfig {
  port: number
  /** Public base URL of this service, as clients call it (checked in NIP-98 auth). */
  publicUrl: string
  appUrl: string
  allowedOrigins: string[]
  relays: string[]
  /** How long before the day ends (midnight UTC) to remind, in hours. */
  remindHoursBefore: number
  dataDir: string
  vapidSubject: string
  /** The push services subscriptions may point at (see PUSH_HOSTS). */
  pushHosts: string[]
}

/**
 * The push services browsers use: Google's (Chrome and other Chromium browsers), Mozilla's
 * (Firefox), Apple's (Safari) and Microsoft's (Edge). Subscriptions may only point at these hosts or
 * their subdomains, so nobody can make the service post to anything else.
 */
export const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']

/** Whether `endpoint` is an https address on one of `hosts` (or a subdomain of one), on the usual port. */
function onPushHost(endpoint: string, hosts: string[]): boolean {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.port && !url.username && hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export function configFromEnv(env = process.env): ServiceConfig {
  const port = Number(env.PORT ?? 8787)
  const appUrl = (env.APP_URL ?? 'http://localhost:4173').replace(/\/$/, '')
  const list = (v: string | undefined, fallback: string[]) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback)
  return {
    port,
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    appUrl,
    allowedOrigins: list(env.ALLOWED_ORIGINS, [appUrl]),
    relays: list(env.RELAYS, ['wss://relay.silvamor.com']),
    remindHoursBefore: Number(env.REMIND_HOURS_BEFORE ?? 4),
    dataDir: env.DATA_DIR ?? './push-data',
    vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    pushHosts: list(env.PUSH_HOSTS, PUSH_HOSTS),
  }
}

/** VAPID keys identify this service to browsers' push services; made once and kept. */
function loadVapidKeys(dataDir: string): { publicKey: string; privateKey: string } {
  const file = join(dataDir, 'vapid.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const keys = webpush.generateVAPIDKeys()
  writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 })
  return keys
}

export function webPushSender(vapid: { publicKey: string; privateKey: string }, subject: string, hosts: string[]) {
  return async (sub: PushSubscriptionData, payload: PushPayload): Promise<SendResult> => {
    // Subscriptions kept from before hosts were checked, or on a host since taken off the list.
    if (!onPushHost(sub.endpoint, hosts)) return 'gone'
    try {
      // A push service that goes quiet for 10 seconds is given up on.
      await webpush.sendNotification(sub, JSON.stringify(payload), { vapidDetails: { subject, ...vapid }, TTL: 24 * 3600, timeout: 10_000 })
      return 'ok'
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      return status === 404 || status === 410 ? 'gone' : 'error'
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 16_000) throw new Error('Request too large')
  }
  return body ? JSON.parse(body) : {}
}

/** The pubkey that signed a valid NIP-98 Authorization header for this request, or null. */
async function authorize(req: IncomingMessage, url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const event = await unpackEventFromToken(req.headers.authorization ?? '')
    return (await validateEvent(event, url, method, body)) ? event.pubkey : null
  } catch {
    return null
  }
}

const isSubscription = (v: unknown): v is PushSubscriptionData => {
  const s = v as PushSubscriptionData
  return typeof s?.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string'
}

export function startService(config: ServiceConfig, deps: { store?: Store; watchtower?: Watchtower; vapidPublicKey?: string } = {}) {
  mkdirSync(config.dataDir, { recursive: true })
  const store = deps.store ?? new Store(join(config.dataDir, 'push.sqlite'))
  const vapid = deps.vapidPublicKey ? null : loadVapidKeys(config.dataDir)
  const watchtower =
    deps.watchtower ??
    createWatchtower({
      relays: config.relays,
      store,
      send: webPushSender(vapid!, config.vapidSubject, config.pushHosts),
      appUrl: config.appUrl,
      remindHoursBefore: config.remindHoursBefore,
      log: (m) => console.log(m),
    })
  const vapidPublicKey = deps.vapidPublicKey ?? vapid!.publicKey

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.statusCode = status
    if (body === undefined) return res.end()
    res.setHeader('Content-Type', typeof body === 'string' ? 'text/plain' : 'application/json')
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    if (origin && (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') return send(res, 204)
    const path = new URL(req.url ?? '/', 'http://x').pathname

    try {
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, subscribers: store.pubkeys().length })
      if (req.method === 'GET' && path === '/vapid-public-key') return send(res, 200, vapidPublicKey)

      if (path === '/subscriptions' && (req.method === 'POST' || req.method === 'DELETE')) {
        const body = (await readJson(req)) as { subscription?: unknown; endpoint?: unknown }
        const pubkey = await authorize(req, `${config.publicUrl}${path}`, req.method, body)
        if (!pubkey) return send(res, 401, { error: 'Sign the request with your Nostr key (NIP-98).' })

        if (req.method === 'POST') {
          if (!isSubscription(body.subscription)) return send(res, 400, { error: 'Missing or invalid push subscription.' })
          if (!onPushHost(body.subscription.endpoint, config.pushHosts)) return send(res, 400, { error: "This push server doesn't send to your browser's push service." })
          store.addSubscription(pubkey, body.subscription)
          return send(res, 201, { ok: true })
        }
        if (typeof body.endpoint !== 'string') return send(res, 400, { error: 'Missing endpoint.' })
        const removed = store.removeSubscription(body.endpoint, pubkey)
        return send(res, removed ? 200 : 404, { ok: removed })
      }
      return send(res, 404, { error: 'Not found' })
    } catch (err) {
      return send(res, 400, { error: err instanceof Error ? err.message : 'Bad request' })
    }
  })

  return new Promise<{ close(): Promise<void>; store: Store }>((resolve) => {
    server.listen(config.port, () =>
      resolve({
        store,
        close: () =>
          new Promise<void>((done) => {
            watchtower.close()
            server.close(() => {
              if (!deps.store) store.close()
              done()
            })
          }),
      }),
    )
  })
}

// Run directly (see push/README.md).
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = configFromEnv()
  startService(config).then(() => console.log(`Silvamor push service on :${config.port}, reading runs from ${config.relays.join(', ')}`))
}
