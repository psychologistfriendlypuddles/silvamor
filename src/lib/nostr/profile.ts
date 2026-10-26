import type { Event, EventTemplate } from 'nostr-tools/pure'
import { isValid, isNip05 } from 'nostr-tools/nip05'

// NIP-01 user metadata (kind 0). Field names follow NIP-24.
export interface ProfileContent {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  banner?: string
  website?: string
  nip05?: string
  lud16?: string
  [key: string]: unknown
}

export function parseProfile(event: Event): ProfileContent {
  try {
    const parsed = JSON.parse(event.content)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Keeps any fields we don't edit (bots, other clients' custom fields) so saving
 * here never wipes data another Nostr app put in the profile.
 */
export function buildProfileEvent(previous: ProfileContent, edits: ProfileContent): EventTemplate {
  const merged: ProfileContent = { ...previous, ...edits }
  for (const key of Object.keys(merged)) {
    if (merged[key] === '' || merged[key] === undefined) delete merged[key]
  }
  return { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(merged) }
}

export function displayName(profile: ProfileContent | undefined, npubFallback: string) {
  return profile?.display_name || profile?.name || `${npubFallback.slice(0, 12)}…`
}

export async function verifyNip05(pubkey: string, nip05: string): Promise<boolean> {
  if (!isNip05(nip05)) return false
  try {
    return await isValid(pubkey, nip05)
  } catch {
    return false
  }
}

export const LUD16_REGEX = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
