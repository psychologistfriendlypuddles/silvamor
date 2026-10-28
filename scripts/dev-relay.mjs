// Minimal in-memory Nostr relay for local development and end-to-end tests.
// Usage: npm run relay   (then start the app with VITE_RELAYS=ws://localhost:7777)
//
// It also fakes a Bitcoin block source (the day's seed block, and its transactions):
//   GET  /api/blocks/tip/height   -> current height (start the app with
//                                    VITE_BLOCK_SOURCES=http://localhost:7777/api/blocks/tip/height)
//   GET  /api/blocks/<height>     -> up to 10 blocks from <height> down (hash and timestamp, as Esplora)
//   GET  /api/block/<hash>        -> its transaction count (200)
//   GET  /api/block/<hash>/txs/<start> -> 25 made-up transactions from <start> (fee, weight, inputs)
//   POST /mine?blocks=N           -> "mines" N blocks (default 1)
//
// And a pretend Lightning provider, so every `<name>@localhost:<port>` is a zappable
// Lightning address (NIP-57) without real money:
//   GET  /.well-known/lnurlp/<name>      -> LNURL-pay info (allowsNostr)
//   GET  /lnurlp/callback?amount&nostr   -> a fake invoice for the zap request (or a plain one, without nostr)
//   POST /lnurlp/pay?invoice=…           -> "pays" it: publishes the zap receipt here
//   GET  /lnurlp/payments                -> the plain (non-zap) payments made, for tests
//
// And a pretend Blossom server (VITE_BLOSSOM_SERVER=http://localhost:7777) for uploads:
//   PUT /upload -> stores the body;  GET /<sha256>.<ext> -> serves it
//
// Tests can also import it: `const relay = await startDevRelay({ port })`.
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { matchFilters } from 'nostr-tools/filter'

const isReplaceable = (k) => k === 0 || k === 3 || (k >= 10000 && k < 20000)
const isAddressable = (k) => k >= 30000 && k < 40000
const dTag = (e) => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''

// Every block holds this many made-up transactions.
const TX_COUNT = 200
const txid = (hash, i) => createHash('sha256').update(`${hash}:${i}`).digest('hex')

/**
 * Transaction `i` of block `hash`: fees and sizes that vary, and every eighth spends from the one
 * before. Some carry an OP_RETURN message, or sweep many coins together, for the sprite to talk about.
 */
function transaction(hash, i) {
  const n = parseInt(txid(hash, i).slice(0, 8), 16)
  const vsize = 110 + (n % 600)
  const parent = i % 8 === 7 ? txid(hash, i - 1) : txid(hash, `outside-${i}`)
  const input = (id) => ({ txid: id, is_coinbase: false, sequence: 0xfffffffd, prevout: { scriptpubkey_type: 'v0_p2wpkh', value: 100_000 } })
  const outputs = [
    { scriptpubkey_type: 'v0_p2wpkh', value: 40_000 + (n % 9_000_000) },
    { scriptpubkey_type: 'v0_p2wpkh', value: 10_000 },
  ]
  if (i % 9 === 4) outputs.push({ scriptpubkey_type: 'op_return', value: 0, scriptpubkey_asm: `OP_RETURN OP_PUSHBYTES_21 ${Buffer.from('gm from the dev relay').toString('hex')}` })
  const extra = i % 13 === 6 ? Array.from({ length: 11 }, (_, k) => input(txid(hash, `swept-${i}-${k}`))) : []
  return {
    txid: txid(hash, i),
    fee: i === 0 ? 0 : vsize * (1 + ((n >>> 10) % 40)),
    weight: vsize * 4,
    vin: i === 0 ? [{ txid: '0'.repeat(64), is_coinbase: true }] : [input(parent), ...extra],
    vout: outputs,
  }
}

export function startDevRelay({ port = 7777, blockHeight = 800_000 } = {}) {
  const events = new Map() // id -> event
  const subs = new Map() // ws -> Map(subId -> filters)
  let height = blockHeight
  // Blocks before the relay started came every 10 minutes; later ones when they were mined.
  const startedAt = Math.floor(Date.now() / 1000)
  const minedAt = new Map() // height -> timestamp
  const mine = (blocks) => {
    for (let i = 0; i < blocks; i++) minedAt.set(++height, Math.floor(Date.now() / 1000))
    return height
  }
  const block = (h) => ({
    id: createHash('sha256').update(`dev-block-${h}`).digest('hex'),
    height: h,
    timestamp: minedAt.get(h) ?? startedAt - (blockHeight - h) * 600,
  })
  const providerKey = generateSecretKey()
  const invoices = new Map() // bolt11 -> zap request JSON
  const plain = new Map() // bolt11 -> a plain payment, until paid
  const payments = [] // plain payments made
  const blobs = new Map() // sha256 -> { type, body }

  function blossom(req, res, url) {
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
    if (req.method === 'OPTIONS') return res.end()
    if (req.method === 'PUT' && url.pathname === '/upload') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const sha256 = createHash('sha256').update(body).digest('hex')
        const type = req.headers['content-type'] ?? 'application/octet-stream'
        blobs.set(sha256, { type, body })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ url: `http://localhost:${port}/${sha256}${type === 'image/png' ? '.png' : ''}`, sha256, size: body.length, type }))
      })
      return true
    }
    const blob = req.method === 'GET' && blobs.get(url.pathname.match(/^\/([0-9a-f]{64})/)?.[1])
    if (blob) {
      res.setHeader('Content-Type', blob.type)
      return res.end(blob.body)
    }
    return false
  }

  function broadcast(event) {
    for (const [client, clientSubs] of subs) {
      for (const [subId, filters] of clientSubs) {
        if (matchFilters(filters, event)) client.send(JSON.stringify(['EVENT', subId, event]))
      }
    }
  }

  // Invoice-shaped enough for amount parsing: "lnbc<amount>n1" + bech32-ish filler.
  function fakeInvoice(msat) {
    const chars = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    let data = ''
    for (let i = 0; i < 120; i++) data += chars[Math.floor(Math.random() * chars.length)]
    return `lnbc${msat / 100}n1${data}`
  }

  function lightning(req, res, url) {
    const json = (body, status = 200) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    const name = url.pathname.match(/^\/\.well-known\/lnurlp\/([^/]+)$/)?.[1]
    if (req.method === 'GET' && name) {
      return json({
        tag: 'payRequest',
        callback: `http://localhost:${port}/lnurlp/callback?to=${name}`,
        minSendable: 1000,
        maxSendable: 100_000_000_000,
        metadata: JSON.stringify([['text/plain', `Pay ${name}`]]),
        allowsNostr: true,
        nostrPubkey: getPublicKey(providerKey),
        commentAllowed: 200,
      })
    }
    if (req.method === 'GET' && url.pathname === '/lnurlp/callback') {
      const msat = Number(url.searchParams.get('amount'))
      const nostr = url.searchParams.get('nostr')
      if (!msat || msat % 1000) return json({ status: 'ERROR', reason: 'amount required' }, 400)
      const pr = fakeInvoice(msat)
      if (nostr) invoices.set(pr, nostr)
      else plain.set(pr, { to: url.searchParams.get('to'), sats: msat / 1000, comment: url.searchParams.get('comment') ?? '' })
      return json({ pr, routes: [] })
    }
    if (req.method === 'POST' && url.pathname === '/lnurlp/pay') {
      const pr = url.searchParams.get('invoice') ?? ''
      if (plain.has(pr)) {
        payments.push(plain.get(pr))
        plain.delete(pr)
        return json({ preimage: '00'.repeat(32) })
      }
      const description = invoices.get(pr)
      if (!description) return json({ status: 'ERROR', reason: 'unknown invoice' }, 404)
      invoices.delete(pr)
      const request = JSON.parse(description)
      const keep = request.tags.filter((t) => ['p', 'e', 'a', 'k'].includes(t[0]))
      const receipt = finalizeEvent(
        {
          kind: 9735,
          created_at: Math.floor(Date.now() / 1000),
          content: '',
          tags: [...keep, ['P', request.pubkey], ['bolt11', pr], ['description', description], ['preimage', '00'.repeat(32)]],
        },
        providerKey,
      )
      if (store(receipt)) broadcast(receipt)
      return json({ preimage: '00'.repeat(32) })
    }
    if (req.method === 'GET' && url.pathname === '/lnurlp/payments') return json(payments)
    return false
  }

  function store(event) {
    if (isReplaceable(event.kind) || isAddressable(event.kind)) {
      for (const old of events.values()) {
        const same =
          old.kind === event.kind && old.pubkey === event.pubkey && (!isAddressable(event.kind) || dTag(old) === dTag(event))
        if (!same) continue
        if (old.created_at > event.created_at) return false
        events.delete(old.id)
      }
    }
    events.set(event.id, event)
    return true
  }

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (lightning(req, res, url) !== false) return
    if (blossom(req, res, url) !== false) return
    if (req.method === 'GET' && url.pathname === '/api/blocks/tip/height') return res.end(String(height))
    const blocksFrom = url.pathname.match(/^\/api\/blocks\/(\d+)$/)
    if (req.method === 'GET' && blocksFrom) {
      const top = Math.min(Number(blocksFrom[1]), height)
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify(Array.from({ length: Math.max(0, Math.min(10, top)) }, (_, i) => block(top - i))))
    }
    const blockInfo = url.pathname.match(/^\/api\/block\/([0-9a-f]{64})$/)
    if (req.method === 'GET' && blockInfo) {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ id: blockInfo[1], tx_count: TX_COUNT }))
    }
    const txPage = url.pathname.match(/^\/api\/block\/([0-9a-f]{64})\/txs\/(\d+)$/)
    if (req.method === 'GET' && txPage) {
      const start = Number(txPage[2])
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify(Array.from({ length: Math.max(0, Math.min(25, TX_COUNT - start)) }, (_, i) => transaction(txPage[1], start + i))))
    }
    if (req.method === 'POST' && url.pathname === '/mine') return res.end(String(mine(Number(url.searchParams.get('blocks') ?? 1))))
    res.statusCode = 404
    res.end()
  })
  const wss = new WebSocketServer({ server: http })
  wss.on('connection', (ws) => {
    subs.set(ws, new Map())
    ws.on('close', () => subs.delete(ws))
    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return ws.send(JSON.stringify(['NOTICE', 'invalid json']))
      }
      const [type, ...rest] = msg
      if (type === 'EVENT') {
        const event = rest[0]
        if (!verifyEvent(event)) return ws.send(JSON.stringify(['OK', event?.id, false, 'invalid: bad signature']))
        const isNew = !events.has(event.id) && store(event)
        ws.send(JSON.stringify(['OK', event.id, true, '']))
        if (isNew) broadcast(event)
      } else if (type === 'REQ') {
        const [subId, ...filters] = rest
        subs.get(ws).set(subId, filters)
        const limit = Math.min(...filters.map((f) => f.limit ?? Infinity))
        const matched = [...events.values()].filter((e) => matchFilters(filters, e)).sort((a, b) => b.created_at - a.created_at)
        for (const e of matched.slice(0, limit)) ws.send(JSON.stringify(['EVENT', subId, e]))
        ws.send(JSON.stringify(['EOSE', subId]))
      } else if (type === 'CLOSE') {
        subs.get(ws).delete(rest[0])
      }
    })
  })

  return new Promise((resolve) => {
    http.listen(port, () =>
      resolve({
        url: `ws://localhost:${port}`,
        heightUrl: `http://localhost:${port}/api/blocks/tip/height`,
        mine: (blocks = 1) => mine(blocks),
        close: () =>
          new Promise((done) => {
            for (const ws of subs.keys()) ws.terminate()
            wss.close()
            http.close(() => done())
          }),
      }),
    )
  })
}

// Run directly: `node scripts/dev-relay.mjs`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 7777)
  startDevRelay({ port, blockHeight: Number(process.env.BLOCK_HEIGHT ?? 800_000) }).then(() =>
    console.log(`dev relay listening on ws://localhost:${port}`),
  )
}
