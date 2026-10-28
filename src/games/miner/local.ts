import type { MinerDeal } from './rules'

// What this browser keeps for Beat the Miner: the day's deal (the same for everyone, so it isn't
// read from the block sources again), and each account's run in progress so a reload picks it up.

// v2: deals now carry each transaction's facts for the sprite.
const dealKey = (blockHash: string) => `silvamor:miner-deal:v2:${blockHash}`
const movesKey = (pubkey: string, seed: string) => `silvamor:miner:${pubkey}:${seed}`

export function loadDeal(blockHash: string): MinerDeal | null {
  try {
    return JSON.parse(localStorage.getItem(dealKey(blockHash)) ?? 'null')
  } catch {
    return null
  }
}

export function saveDeal(blockHash: string, deal: MinerDeal) {
  try {
    localStorage.setItem(dealKey(blockHash), JSON.stringify(deal))
  } catch {
    // Storage full or blocked: it's read from the block sources again next time.
  }
}

export function loadMoves(pubkey: string, seed: string): string {
  try {
    return localStorage.getItem(movesKey(pubkey, seed)) ?? ''
  } catch {
    return ''
  }
}

export function saveMoves(pubkey: string, seed: string, moves: string) {
  try {
    localStorage.setItem(movesKey(pubkey, seed), moves)
  } catch {
    // The run still plays; it just won't survive a reload.
  }
}
