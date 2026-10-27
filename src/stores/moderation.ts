import { useEffect } from 'react'
import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { DISCOVERY_RELAYS, pool, publishTo } from '../lib/nostr/pool'
import {
  CURATION_KIND,
  DEFAULT_SETTINGS,
  FEATURED_D,
  MODERATION_D,
  MUTE_LIST_KIND,
  REPORT_KIND,
  buildFeatured,
  buildSettings,
  buildSpriteReport,
  pTagPubkeys,
  parseFeatured,
  parseSettings,
  reportersBySprite,
  spriteBlocked,
  type ModerationSettings,
  type ReportReason,
} from '../lib/moderation'
import { APP_DATA_KIND, SPRITE_KIND, type Sprite } from '../lib/sprites'
import type { AppSigner } from '../lib/nostr/signers'
import { gameReadRelays, gameWriteRelays } from './relays'

/** Whose picks fill the shop's "Featured" shelf besides people you follow (VITE_SPRITE_CURATORS, npubs or hex). */
export const CURATORS: string[] = (import.meta.env.VITE_SPRITE_CURATORS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)
  .map((s: string) => {
    try {
      return s.startsWith('npub') ? (nip19.decode(s).data as string) : s
    } catch {
      return ''
    }
  })
  .filter((s: string) => /^[0-9a-f]{64}$/.test(s))

const relays = () => [...new Set([...gameReadRelays(), ...DISCOVERY_RELAYS])]
const cacheKey = (pubkey: string) => `silvamor:moderation:${pubkey}`

interface ModerationState {
  me: string | null
  settings: ModerationSettings
  settingsAt: number
  /** Muted in any Nostr app (NIP-51 mute list). */
  muted: string[]
  follows: string[]
  /** Sprite address → who reported it (people you follow, and you). */
  reporters: Record<string, string[]>
  /** Curator or followed pubkey → the sprites they feature. */
  featured: Record<string, string[]>
  load(signer: AppSigner, pubkey: string): Promise<void>
  saveSettings(signer: AppSigner, settings: ModerationSettings): Promise<void>
  report(signer: AppSigner, sprite: Sprite, reason: ReportReason, note: string): Promise<void>
  setFeatured(signer: AppSigner, ids: string[]): Promise<void>
}

const readCache = (pubkey: string): { at: number; settings: ModerationSettings } | null => {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey))
    return raw ? (JSON.parse(raw) as { at: number; settings: ModerationSettings }) : null
  } catch {
    return null
  }
}
const writeCache = (pubkey: string, at: number, settings: ModerationSettings) => {
  try {
    localStorage.setItem(cacheKey(pubkey), JSON.stringify({ at, settings }))
  } catch {
    /* private mode: settings still apply this session */
  }
}

async function chunks(authors: string[], filter: (a: string[]) => Parameters<typeof pool.querySync>[1]): Promise<Event[]> {
  const out: Event[] = []
  for (let i = 0; i < authors.length; i += 150) out.push(...(await pool.querySync(relays(), filter(authors.slice(i, i + 150)), { maxWait: 5000 })))
  return out
}

export const useModeration = create<ModerationState>((set, get) => ({
  me: null,
  settings: DEFAULT_SETTINGS,
  settingsAt: 0,
  muted: [],
  follows: [],
  reporters: {},
  featured: {},

  async load(signer, pubkey) {
    if (get().me === pubkey) return
    const cached = readCache(pubkey)
    set({ me: pubkey, settings: cached?.settings ?? DEFAULT_SETTINGS, settingsAt: cached?.at ?? 0 })

    const [settingsEvent, mute, contacts] = await Promise.all([
      pool.get(relays(), { kinds: [APP_DATA_KIND], authors: [pubkey], '#d': [MODERATION_D] }, { maxWait: 5000 }),
      pool.get(relays(), { kinds: [MUTE_LIST_KIND], authors: [pubkey] }, { maxWait: 5000 }),
      pool.get(relays(), { kinds: [3], authors: [pubkey] }, { maxWait: 5000 }),
    ])
    // Decrypt only when the settings changed elsewhere, so signer apps don't ask every time.
    if (settingsEvent && settingsEvent.created_at > get().settingsAt) {
      try {
        const settings = parseSettings(await signer.nip44Decrypt(pubkey, settingsEvent.content))
        set({ settings, settingsAt: settingsEvent.created_at })
        writeCache(pubkey, settingsEvent.created_at, settings)
      } catch {
        /* keep the cached settings */
      }
    }
    const follows = pTagPubkeys(contacts)
    set({ muted: pTagPubkeys(mute), follows })

    const people = [...new Set([...follows, pubkey])]
    const [reports, curations] = await Promise.all([
      chunks(people, (authors) => ({ kinds: [REPORT_KIND], authors, '#k': [String(SPRITE_KIND)], limit: 2000 })),
      chunks([...new Set([...CURATORS, ...people])], (authors) => ({ kinds: [CURATION_KIND], authors, '#d': [FEATURED_D] })),
    ])
    const reporters = Object.fromEntries([...reportersBySprite(reports)].map(([id, who]) => [id, [...who]]))
    const newest = new Map<string, Event>()
    for (const e of curations) if ((newest.get(e.pubkey)?.created_at ?? 0) < e.created_at) newest.set(e.pubkey, e)
    set({ reporters, featured: Object.fromEntries([...newest].map(([pk, e]) => [pk, parseFeatured(e)])) })
  },

  async saveSettings(signer, settings) {
    const me = get().me
    if (!me) throw new Error('Not signed in.')
    const event = await signer.signEvent(buildSettings(await signer.nip44Encrypt(me, JSON.stringify(settings))))
    set({ settings, settingsAt: event.created_at })
    writeCache(me, event.created_at, settings)
    await publishTo(gameWriteRelays(), event)
  },

  async report(signer, sprite, reason, note) {
    const me = get().me
    if (!me) throw new Error('Not signed in.')
    await publishTo(gameWriteRelays(), await signer.signEvent(buildSpriteReport(sprite, reason, note)))
    const who = new Set([...(get().reporters[sprite.id] ?? []), me])
    set({ reporters: { ...get().reporters, [sprite.id]: [...who] } })
  },

  async setFeatured(signer, ids) {
    const me = get().me
    if (!me) throw new Error('Not signed in.')
    await publishTo(gameWriteRelays(), await signer.signEvent(buildFeatured(ids)))
    set({ featured: { ...get().featured, [me]: ids } })
  },
}))

/** Whether a sprite is off for this player: 'hidden' (artist hidden or muted), 'reported', or null. */
export function useSpriteBlock(sprite: Sprite | undefined): 'hidden' | 'reported' | null {
  const { me, settings, muted, follows } = useModeration()
  const reporters = useModeration((s) => (sprite ? s.reporters[sprite.id] : undefined))
  if (!sprite || !me) return null
  return spriteBlocked(sprite, {
    me,
    hidden: new Set([...settings.hiddenArtists, ...muted]),
    reporters: reporters && new Set(reporters),
    follows: new Set(follows),
    blurReported: settings.blurReported,
  })
}

/** Loads the signed-in player's moderation settings, reports and picks once per session. */
export function useLoadModeration(signer: AppSigner | null, pubkey: string | null) {
  useEffect(() => {
    if (signer && pubkey) void useModeration.getState().load(signer, pubkey)
  }, [signer, pubkey])
}
