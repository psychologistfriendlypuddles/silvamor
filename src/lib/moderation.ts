import type { Event, EventTemplate } from 'nostr-tools/pure'
import { APP_DATA_KIND, SPRITE_KIND, type Sprite } from './sprites'

// Keeping the sprite shop pleasant without anyone in charge (docs/SPRITES.md, "Moderation"):
// each player hides artists they don't want to see, reports (NIP-56) from people they follow
// can blur a sprite, and curated picks (NIP-51) make a "Featured" shelf.

export const REPORT_KIND = 1984
/** NIP-51 mute list: people muted in any Nostr app are hidden here too. */
export const MUTE_LIST_KIND = 10000
/** NIP-51 curation set holding a player's featured sprites. */
export const CURATION_KIND = 30004
export const FEATURED_D = 'silvamor-sprites'
export const MODERATION_D = 'silvamor/moderation'
/** Longest note a report may carry (characters); Silvamor's relay refuses longer ones. */
export const MAX_REPORT_NOTE = 83
/** Reports from this many people you follow blur a sprite. */
export const REPORT_THRESHOLD = 3

export const REPORT_REASONS = [
  { value: 'nudity', label: 'Nudity or sexual content' },
  { value: 'profanity', label: 'Hateful or offensive' },
  { value: 'illegal', label: 'Illegal' },
  { value: 'impersonation', label: 'Copied or impersonating' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]['value']

const tag = (e: Event, name: string) => e.tags.find((t) => t[0] === name)?.[1]

/** A NIP-56 report about a sprite: the artist (p) and the sprite (a), with the reason. */
export function buildSpriteReport(sprite: Sprite, reason: ReportReason, note: string): EventTemplate {
  return {
    kind: REPORT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: note.trim().slice(0, MAX_REPORT_NOTE),
    tags: [
      ['p', sprite.author!, reason],
      ['a', sprite.id, reason],
      ['k', String(SPRITE_KIND)],
    ],
  }
}

/** Who reported each sprite (by its address), from a pile of report events. */
export function reportersBySprite(reports: Event[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const e of reports) {
    if (e.kind !== REPORT_KIND) continue
    for (const t of e.tags) {
      if (t[0] !== 'a' || !t[1]?.startsWith(`${SPRITE_KIND}:`)) continue
      out.set(t[1], (out.get(t[1]) ?? new Set()).add(e.pubkey))
    }
  }
  return out
}

/** The pubkeys in an event's p tags: a mute list's public part, or a contact list. */
export function pTagPubkeys(e: Event | null | undefined): string[] {
  return (e?.tags ?? []).filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? '')).map((t) => t[1])
}

export function buildFeatured(spriteIds: string[]): EventTemplate {
  return {
    kind: CURATION_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [['d', FEATURED_D], ['title', 'Featured Silvamor sprites'], ...spriteIds.map((id) => ['a', id])],
  }
}

export function parseFeatured(e: Event): string[] {
  if (e.kind !== CURATION_KIND || tag(e, 'd') !== FEATURED_D) return []
  return e.tags.filter((t) => t[0] === 'a' && t[1]?.startsWith(`${SPRITE_KIND}:`)).map((t) => t[1])
}

/** Private settings, NIP-44 encrypted to yourself inside a NIP-78 app-data event. */
export interface ModerationSettings {
  hiddenArtists: string[]
  /** Blur sprites reported by REPORT_THRESHOLD+ people you follow (and show the default instead). */
  blurReported: boolean
}
export const DEFAULT_SETTINGS: ModerationSettings = { hiddenArtists: [], blurReported: true }

export function parseSettings(json: string): ModerationSettings {
  try {
    const v = JSON.parse(json) as Partial<ModerationSettings>
    return {
      hiddenArtists: Array.isArray(v.hiddenArtists) ? v.hiddenArtists.filter((p) => /^[0-9a-f]{64}$/.test(p)) : [],
      blurReported: v.blurReported !== false,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function buildSettings(ciphertext: string): EventTemplate {
  return {
    kind: APP_DATA_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: ciphertext,
    tags: [['d', MODERATION_D], ['alt', 'Silvamor settings']],
  }
}

/** Whether a sprite is off for you: its artist hidden or muted, or reported by enough people you follow (or you). */
export function spriteBlocked(
  sprite: Sprite,
  f: { me: string; hidden: Set<string>; reporters: Set<string> | undefined; follows: Set<string>; blurReported: boolean },
): 'hidden' | 'reported' | null {
  if (!sprite.author || sprite.author === f.me) return null
  if (f.hidden.has(sprite.author)) return 'hidden'
  if (!f.reporters) return null
  if (f.reporters.has(f.me)) return 'reported'
  const friends = [...f.reporters].filter((p) => f.follows.has(p)).length
  return f.blurReported && friends >= REPORT_THRESHOLD ? 'reported' : null
}
