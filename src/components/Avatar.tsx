import { useState } from 'react'
import { useProfile } from '../stores/profiles'
import { HonorBadge } from './HonorBadge'

const gradients = [
  'from-grape to-bubblegum',
  'from-mint to-sky',
  'from-lemon to-tangerine',
  'from-bubblegum to-tangerine',
  'from-sky to-grape',
  'from-mint to-lemon',
]

/**
 * Profile picture, or a colorful gradient picked from the pubkey when there is none,
 * with the player's wager honor badge in the corner (`badge={false}` for long lists).
 */
export function Avatar({ pubkey, src, className = 'size-10', badge = true }: { pubkey: string; src?: string; className?: string; badge?: boolean }) {
  const profile = useProfile(pubkey)
  const picture = src ?? profile?.picture
  const [failed, setFailed] = useState<string | null>(null)
  const gradient = gradients[parseInt(pubkey.slice(0, 2), 16) % gradients.length]
  const initial = (profile?.display_name || profile?.name || '?').trim().charAt(0).toUpperCase()

  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      {picture && failed !== picture ? (
        <img src={picture} alt="" onError={() => setFailed(picture)} className="size-full rounded-full object-cover ring-2 ring-white/20" />
      ) : (
        <span
          className={`flex size-full items-center justify-center rounded-full bg-gradient-to-br font-bold text-night-900 ring-2 ring-white/20 ${gradient}`}
        >
          {initial}
        </span>
      )}
      {badge && <HonorBadge pubkey={pubkey} />}
    </span>
  )
}
