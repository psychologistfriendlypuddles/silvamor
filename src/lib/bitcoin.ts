// Bitcoin block height: the shared clock for turn limits (docs/PROTOCOL.md, "Turn clock").

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

/**
 * Asks every source and takes the lowest answer: a lagging or wrong source can
 * then only delay a strike, never hand one out early. Null when none answer.
 */
export async function fetchTipHeight(sources = BLOCK_SOURCES): Promise<number | null> {
  const results = await Promise.allSettled(sources.map(fetchHeight))
  const heights = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  return heights.length > 0 ? Math.min(...heights) : null
}

/** Blocks arrive about every 10 minutes on average. For rough "≈" hints only. */
export const AVERAGE_BLOCK_MINUTES = 10

export function blocksToApproxTime(blocks: number): string {
  const minutes = blocks * AVERAGE_BLOCK_MINUTES
  if (minutes < 60) return `${minutes} min`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 60 / 24)} days`
}
