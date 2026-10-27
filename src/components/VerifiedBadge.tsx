import { BadgeCheck } from 'lucide-react'
import { useVerifiedNip05 } from '../stores/profiles'

/** A check mark when the player's NIP-05 address verifies (with the address, if `showName`). */
export function VerifiedBadge({ pubkey, showName }: { pubkey: string; showName?: boolean }) {
  const nip05 = useVerifiedNip05(pubkey)
  if (!nip05) return null
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-mint" title={`Verified: ${nip05}`}>
      <BadgeCheck className="size-4 shrink-0" />
      {showName && <span className="truncate text-sm">{nip05}</span>}
    </span>
  )
}
