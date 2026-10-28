import { fetchTxCount, fetchTxPage, BLOCK_SOURCES, type Block } from '../../lib/bitcoin'
import { dealFrom, minerSeed, pageStarts, type MinerDeal } from './rules'

/** The day's deal, read from its seed block: a few pages of its transactions. */
export async function fetchDeal(day: string, block: Block, sources = BLOCK_SOURCES): Promise<MinerDeal> {
  const seed = minerSeed(day, block.hash)
  const starts = pageStarts(seed, await fetchTxCount(block.hash, sources))
  const pages = await Promise.all(starts.map((s) => fetchTxPage(block.hash, s, sources)))
  return dealFrom(seed, pages)
}
