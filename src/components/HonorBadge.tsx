import { TIER_STYLE, honorSummary, useHonorOf } from '../hooks/useHonorOf'

/** The honor circle on the lower-right of a profile picture. Nothing while it's still loading. */
export function HonorBadge({ pubkey }: { pubkey: string }) {
  const honor = useHonorOf(pubkey)
  if (!honor) return null
  const { label, className } = TIER_STYLE[honor.tier]
  const text = `${label} · ${honorSummary(honor)}`
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={`absolute -right-[4%] -bottom-[4%] aspect-square w-[34%] min-w-2 rounded-full ring-2 ring-night-950 ${className}`}
    />
  )
}
