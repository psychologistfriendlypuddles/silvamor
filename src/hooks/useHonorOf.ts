import { useEffect } from 'react'
import { useHonor } from '../stores/honor'
import type { Honor, HonorTier } from '../lib/wager'
import { FEATURES } from '../features'

export const TIER_STYLE: Record<HonorTier, { label: string; className: string }> = {
  gold: { label: 'Gold', className: 'bg-gradient-to-br from-[#ffe27a] to-[#e0a800]' },
  silver: { label: 'Silver', className: 'bg-gradient-to-br from-[#f1f4f8] to-[#9aa3b1]' },
  bronze: { label: 'Bronze', className: 'bg-gradient-to-br from-[#e9a66b] to-[#a0602a]' },
  new: { label: 'New', className: 'bg-slate-400' },
  red: { label: 'Red', className: 'bg-rose-500' },
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "paid 32 wagers to 18 players", "owes 1 wager (2 days overdue)", "no wagers lost yet". */
export function honorSummary(h: Honor) {
  if (h.unpaid) {
    const days = Math.floor(h.overdueFor / 86400)
    const hours = Math.floor(h.overdueFor / 3600)
    return `owes ${plural(h.unpaid, 'wager')} (${days ? plural(days, 'day') : hours ? plural(hours, 'hour') : 'just now'} overdue)`
  }
  if (h.paid) return `paid ${plural(h.paid, 'wager')} to ${plural(h.winnersPaid, 'player')}`
  return 'no wagers lost yet'
}

/** A player's wager honor, or undefined while loading (and always while wagers are off). */
export function useHonorOf(pubkey: string) {
  const record = useHonor((s) => s.records[pubkey])
  useEffect(() => {
    if (FEATURES.wagers) useHonor.getState().fetch(pubkey)
  }, [pubkey])
  return FEATURES.wagers ? record?.honor : undefined
}
