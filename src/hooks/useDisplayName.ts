import { useEffect } from 'react'
import * as nip19 from 'nostr-tools/nip19'
import { displayName } from '../lib/nostr/profile'
import { useProfile, useProfiles } from '../stores/profiles'

/** Display name for any pubkey, fetching the profile on first use. */
export function useDisplayName(pubkey: string) {
  const profile = useProfile(pubkey)
  useEffect(() => {
    useProfiles.getState().fetch(pubkey)
  }, [pubkey])
  return displayName(profile, nip19.npubEncode(pubkey))
}

export function timeAgo(unix: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
