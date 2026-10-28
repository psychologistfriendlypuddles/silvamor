// Bitcoin blocks: each day's Daily Deal is seeded by the first block after midnight UTC
// (docs/PROTOCOL.md, "Daily Deal").

const DEFAULT_SOURCES = ['https://mempool.space/api/blocks/tip/height', 'https://blockstream.info/api/blocks/tip/height']

/** VITE_BLOCK_SOURCES (comma-separated URLs returning the tip height as text) replaces the defaults. */
export const BLOCK_SOURCES: string[] =
  (import.meta.env.VITE_BLOCK_SOURCES as string | undefined)?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_SOURCES

async function fetchHeight(url: string): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const height = Number((await res.text()).trim())
  if (!Number.isSafeInteger(height) || height <= 0) throw new Error(`${url}: not a block height`)
  return height
}

/** Blocks arrive about every 10 minutes on average. */
export const AVERAGE_BLOCK_MINUTES = 10

export interface Block {
  height: number
  hash: string
  /** Header timestamp (unix seconds), set by the miner: up to about 2 hours off. */
  timestamp: number
}

/** The Esplora-style API (mempool.space, blockstream.info) behind a tip-height source, if it is one. */
const apiBase = (source: string) => source.match(/^(.*)\/blocks\/tip\/height$/)?.[1]

/** Up to 10 blocks, from `height` down. */
async function fetchBlocks(base: string, height: number): Promise<Block[]> {
  const res = await fetch(`${base}/blocks/${height}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`${base}: ${res.status}`)
  const list: unknown = await res.json()
  if (!Array.isArray(list)) throw new Error(`${base}: not a block list`)
  return list.map((b: { id?: unknown; height?: unknown; timestamp?: unknown }) => {
    if (typeof b.id !== 'string' || !/^[0-9a-f]{64}$/.test(b.id) || !Number.isSafeInteger(b.height) || !Number.isSafeInteger(b.timestamp)) {
      throw new Error(`${base}: bad block`)
    }
    return { height: b.height as number, hash: b.id, timestamp: b.timestamp as number }
  })
}

/** Miners may set a block's clock up to 2 hours ahead, so older blocks can't reach `time`. */
const CLOCK_SLACK = 2 * 3600

async function firstBlockFrom(source: string, time: number): Promise<Block | null> {
  const base = apiBase(source)
  if (!base) throw new Error(`${source}: no block API`)
  const tip = await fetchHeight(source)
  const now = Date.now() / 1000
  if (now < time) return null
  const seen: Block[] = []
  const lowest = () => seen.filter((b) => b.timestamp >= time).sort((a, b) => a.height - b.height)[0]
  // Start a few hours of blocks above where `time` should be, then walk down until a whole page is too old.
  const start = Math.min(tip, tip - Math.floor((now - time) / (AVERAGE_BLOCK_MINUTES * 60)) + 30)
  for (let h = start, pages = 0; h > 0 && pages < 100; h -= 10, pages++) {
    const page = await fetchBlocks(base, h)
    seen.push(...page)
    if (page.length === 0 || page.every((b) => b.timestamp < time - CLOCK_SLACK)) break
  }
  // Blocks came slower than usual: the one we want is above the start, if it exists yet.
  for (let h = start; !lowest() && h < tip; ) {
    h = Math.min(h + 10, tip)
    seen.push(...(await fetchBlocks(base, h)))
  }
  return lowest() ?? null
}

/**
 * The lowest-height block whose timestamp is at or after `time` (unix seconds), or null
 * if none has been mined yet. Asks the sources in turn until one answers.
 */
export async function findFirstBlockAfter(time: number, sources = BLOCK_SOURCES): Promise<Block | null> {
  let error: unknown = new Error('No block source')
  for (const source of sources) {
    try {
      return await firstBlockFrom(source, time)
    } catch (err) {
      error = err
    }
  }
  throw error
}

/** One of a block's transactions, as Esplora lists them. */
export interface ListedTx {
  txid: string
  /** Sats. */
  fee: number
  weight: number
  /** The transactions it spends from. */
  inputs: string[]
  coinbase: boolean
}

async function fromSources<T>(sources: string[], ask: (base: string) => Promise<T>): Promise<T> {
  let error: unknown = new Error('No block source')
  for (const source of sources) {
    const base = apiBase(source)
    if (!base) continue
    try {
      return await ask(base)
    } catch (err) {
      error = err
    }
  }
  throw error
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

/** How many transactions block `hash` holds. */
export function fetchTxCount(hash: string, sources = BLOCK_SOURCES): Promise<number> {
  return fromSources(sources, async (base) => {
    const count = (await getJson(`${base}/block/${hash}`)) as { tx_count?: unknown }
    if (!Number.isSafeInteger(count.tx_count)) throw new Error(`${base}: no transaction count`)
    return count.tx_count as number
  })
}

/** The 25 transactions of block `hash` from position `start` (a multiple of 25). */
export function fetchTxPage(hash: string, start: number, sources = BLOCK_SOURCES): Promise<ListedTx[]> {
  return fromSources(sources, async (base) => {
    const list = await getJson(`${base}/block/${hash}/txs/${start}`)
    if (!Array.isArray(list)) throw new Error(`${base}: not a transaction list`)
    return list.map((t: { txid?: unknown; fee?: unknown; weight?: unknown; vin?: { txid?: unknown; is_coinbase?: unknown }[] }) => {
      if (typeof t.txid !== 'string' || !/^[0-9a-f]{64}$/.test(t.txid) || !Number.isSafeInteger(t.fee) || !Number.isSafeInteger(t.weight) || !Array.isArray(t.vin)) {
        throw new Error(`${base}: bad transaction`)
      }
      return {
        txid: t.txid,
        fee: t.fee as number,
        weight: t.weight as number,
        inputs: t.vin.map((v) => v.txid).filter((id): id is string => typeof id === 'string'),
        coinbase: t.vin.some((v) => v.is_coinbase === true),
      }
    })
  })
}
