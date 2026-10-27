import { useEffect, useState } from 'react'
import * as nip19 from 'nostr-tools/nip19'
import { Check, Copy, X } from 'lucide-react'
import { useProfile, useProfiles } from '../stores/profiles'
import { usePlayerSprite } from '../stores/sprites'
import { useSigner } from '../stores/session'
import { useDisplayName } from '../hooks/useDisplayName'
import { copyText } from '../lib/clipboard'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import { SpriteView } from './Sprite'
import { VerifiedBadge } from './VerifiedBadge'
import { TipButton } from './Tip'

/**
 * A player's profile in a sheet: picture, name, about, sprite, and a tip button (any amount,
 * starting at 21 sats) unless `tipping={false}`.
 */
export function PlayerSheet({ pubkey, tipping = true, onClose }: { pubkey: string | null; tipping?: boolean; onClose(): void }) {
  return <Modal open={!!pubkey} onClose={onClose}>{pubkey && <PlayerProfile pubkey={pubkey} tipping={tipping} onClose={onClose} />}</Modal>
}

function PlayerProfile({ pubkey, tipping, onClose }: { pubkey: string; tipping: boolean; onClose(): void }) {
  const { pubkey: me } = useSigner()
  const profile = useProfile(pubkey)
  const name = useDisplayName(pubkey)
  const sprite = usePlayerSprite(pubkey)
  const npub = nip19.npubEncode(pubkey)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void useProfiles.getState().fetch(pubkey)
  }, [pubkey])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar pubkey={pubkey} className="size-16 text-2xl" />
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-2xl font-display">
              <span className="truncate">{name}</span>
              <VerifiedBadge pubkey={pubkey} />
            </h2>
            <button
              onClick={() => copyText(npub).then(() => setCopied(true))}
              className="flex items-center gap-1 text-xs text-white/45 hover:text-white"
              aria-label="Copy npub"
            >
              {npub.slice(0, 12)}…{npub.slice(-6)}
              {copied ? <Check className="size-3 text-mint" /> : <Copy className="size-3" />}
            </button>
          </div>
        </div>
        <button onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close profile">
          <X className="size-5" />
        </button>
      </div>

      {profile?.about && <p className="line-clamp-4 text-sm whitespace-pre-line text-white/65">{profile.about}</p>}

      <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
        <SpriteView sprite={sprite} size={64} />
        <p className="text-sm text-white/55">
          Plays as <b className="text-white/80">{sprite.name}</b>
        </p>
      </div>

      {pubkey !== me && tipping && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-white/55">Send {name} a tip, just because. It goes straight to their wallet.</p>
          <TipButton pubkey={pubkey} label={`Tip ${name}`} />
        </div>
      )}
    </div>
  )
}
