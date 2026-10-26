import { useEffect } from 'react'
import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { DISCOVERY_RELAYS, pool, publishTo } from '../lib/nostr/pool'
import { buildProfileEvent, parseProfile, verifyNip05, type ProfileContent } from '../lib/nostr/profile'
import type { AppSigner } from '../lib/nostr/signers'

interface CachedProfile {
  content: ProfileContent
  createdAt: number
}

interface ProfileState {
  profiles: Record<string, CachedProfile>
  pending: Record<string, boolean>
  fetch(pubkey: string, relays?: string[], force?: boolean): Promise<void>
  /** One batched query for many profiles, e.g. everyone the user follows. */
  fetchMany(pubkeys: string[]): Promise<void>
  save(signer: AppSigner, pubkey: string, edits: ProfileContent, relays: string[]): Promise<string[]>
}

export const useProfiles = create<ProfileState>((set, get) => {
  const remember = (event: Event) => {
    const existing = get().profiles[event.pubkey]
    if (existing && existing.createdAt >= event.created_at) return
    set({ profiles: { ...get().profiles, [event.pubkey]: { content: parseProfile(event), createdAt: event.created_at } } })
  }

  return {
    profiles: {},
    pending: {},

    async fetch(pubkey, relays = [], force = false) {
      if (get().pending[pubkey] || (!force && get().profiles[pubkey])) return
      set({ pending: { ...get().pending, [pubkey]: true } })
      try {
        const targets = [...new Set([...DISCOVERY_RELAYS, ...relays])]
        const events = await pool.querySync(targets, { kinds: [0], authors: [pubkey] }, { maxWait: 4000 })
        events.forEach(remember)
      } finally {
        set({ pending: { ...get().pending, [pubkey]: false } })
      }
    },

    async fetchMany(pubkeys) {
      const missing = pubkeys.filter((p) => !get().profiles[p] && !get().pending[p])
      for (let i = 0; i < missing.length; i += 150) {
        const authors = missing.slice(i, i + 150)
        const events = await pool.querySync(DISCOVERY_RELAYS, { kinds: [0], authors }, { maxWait: 4000 })
        events.forEach(remember)
      }
    },

    async save(signer, pubkey, edits, relays) {
      if (!get().profiles[pubkey]) {
        // Not having a profile cached may just mean slow relays. Look once more, harder,
        // before publishing something that would replace the user's real profile.
        const existing = await pool.querySync([...new Set([...DISCOVERY_RELAYS, ...relays])], { kinds: [0], authors: [pubkey] }, { maxWait: 8000 })
        existing.forEach(remember)
        if (get().profiles[pubkey]) {
          throw new Error('Found your existing profile on the relays and loaded it. Check the form, then save again.')
        }
      }
      const previous = get().profiles[pubkey]?.content ?? {}
      const event = await signer.signEvent(buildProfileEvent(previous, edits))
      const ok = await publishTo([...new Set([...relays, ...DISCOVERY_RELAYS])], event)
      remember(event)
      return ok
    },
  }
})

// NIP-05 checks, cached per "pubkey|identifier" so a profile change re-checks.
const nip05Checks = create<{ results: Record<string, boolean>; check(pubkey: string, nip05: string): void }>((set, get) => ({
  results: {},
  check(pubkey, nip05) {
    const key = `${pubkey}|${nip05}`
    if (key in get().results) return
    set({ results: { ...get().results, [key]: false } })
    verifyNip05(pubkey, nip05).then((ok) => set({ results: { ...get().results, [key]: ok } }))
  },
}))

/** The verified NIP-05 identifier of a pubkey, or null. */
export function useVerifiedNip05(pubkey: string): string | null {
  const nip05 = useProfile(pubkey)?.nip05
  const ok = nip05Checks((s) => (nip05 ? s.results[`${pubkey}|${nip05}`] : false))
  useEffect(() => {
    if (nip05) nip05Checks.getState().check(pubkey, nip05)
  }, [pubkey, nip05])
  return ok && nip05 ? nip05.replace(/^_@/, '') : null
}

export function useProfile(pubkey: string | null | undefined) {
  return useProfiles((s) => (pubkey ? s.profiles[pubkey]?.content : undefined))
}
