import { create } from 'zustand'
import { fetchTipHeight } from '../lib/bitcoin'

const POLL_MS = 30_000

/**
 * A strike only becomes official once its block has been known for this long,
 * so a move made just before the block was found has time to arrive.
 */
export const STRIKE_GRACE_MS = 60_000

interface BlocksState {
  /** Newest block height known, or null until a source answers. */
  height: number | null
  /** When each height was first seen (ms). Heights already current when the app opened count as old. */
  seenAt: Record<number, number>
  /** No source answered on the last try. */
  unreachable: boolean
  refresh(): Promise<number | null>
  start(): () => void
}

export const useBlocks = create<BlocksState>((set, get) => ({
  height: null,
  seenAt: {},
  unreachable: false,

  async refresh() {
    const height = await fetchTipHeight()
    if (height === null) {
      set({ unreachable: true })
      return get().height
    }
    const { height: previous, seenAt } = get()
    if (previous === null || height > previous) {
      set({ height, seenAt: { ...seenAt, [height]: previous === null ? 0 : Date.now() }, unreachable: false })
    } else {
      set({ unreachable: false })
    }
    return get().height
  },

  start() {
    get().refresh()
    const timer = setInterval(() => get().refresh(), POLL_MS)
    return () => clearInterval(timer)
  },
}))

/** Newest height that counts for strikes: the tip, or the one before it during the grace period. */
export function settledHeight(height: number | null, seenAt: Record<number, number>, now: number): number | null {
  if (height === null) return null
  return now - (seenAt[height] ?? 0) >= STRIKE_GRACE_MS ? height : height - 1
}
