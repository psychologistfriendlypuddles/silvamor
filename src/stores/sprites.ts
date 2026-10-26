import { useEffect } from 'react'
import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { pool, publishTo } from '../lib/nostr/pool'
import {
  APP_DATA_KIND,
  BUILTIN_SPRITES,
  DEFAULT_SPRITE,
  SPRITE_CHOICE_D,
  SPRITE_KIND,
  buildSpriteChoice,
  parseSprite,
  parseSpriteChoice,
  type Sprite,
} from '../lib/sprites'
import type { AppSigner } from '../lib/nostr/signers'
import { gameReadRelays, gameWriteRelays } from './relays'
import { useSpriteBlock } from './moderation'

interface SpriteState {
  /** pubkey → sprite id they picked (absent: not looked up yet; null: none, so the default). */
  choices: Record<string, { id: string | null; at: number }>
  /** Sprite id → sprite. Built-ins are always here. */
  sprites: Record<string, Sprite>
  /** Sprites published by each author (for "your sprites" on the profile). */
  byAuthor: Record<string, string[]>
  /** Every sprite published for Silvamor that the relays have (the shop), newest first. */
  catalog: string[] | null
  request(pubkey: string): void
  loadSprites(ids: string[]): Promise<void>
  loadCatalog(): Promise<void>
  loadAuthor(pubkey: string): Promise<void>
  addSprite(event: Event): Sprite | null
  choose(signer: AppSigner, pubkey: string, id: string): Promise<void>
}

const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

export const useSprites = create<SpriteState>((set, get) => {
  const rememberChoice = (e: Event) => {
    const prev = get().choices[e.pubkey]
    if (prev && prev.id !== null && prev.at >= e.created_at) return
    set({ choices: { ...get().choices, [e.pubkey]: { id: parseSpriteChoice(e), at: e.created_at } } })
  }

  const loadSprites = async (ids: string[]): Promise<void> => {
    const missing = [...new Set(ids)].filter((id) => !get().sprites[id] && id.startsWith(`${SPRITE_KIND}:`))
    if (!missing.length) return
    const filters = missing.map((id) => {
      const [, author, d] = id.split(':')
      return { kinds: [SPRITE_KIND], authors: [author], '#d': [d] }
    })
    const events = await Promise.all(filters.map((f) => pool.querySync(gameReadRelays(), f, { maxWait: 4000 })))
    events.flat().forEach((e) => get().addSprite(e))
  }

  // Lookups wait a moment so a screen full of players becomes one query.
  const flush = async () => {
    timer = null
    const authors = [...queue]
    queue.clear()
    for (let i = 0; i < authors.length; i += 150) {
      const chunk = authors.slice(i, i + 150)
      const events = await pool.querySync(gameReadRelays(), { kinds: [APP_DATA_KIND], authors: chunk, '#d': [SPRITE_CHOICE_D] }, { maxWait: 4000 })
      const choices = { ...get().choices }
      for (const pk of chunk) choices[pk] ??= { id: null, at: 0 }
      set({ choices })
      events.forEach(rememberChoice)
      await loadSprites(chunk.map((pk) => get().choices[pk]?.id).filter((id): id is string => !!id))
    }
  }

  return {
    choices: {},
    sprites: Object.fromEntries(BUILTIN_SPRITES.map((s) => [s.id, s])),
    byAuthor: {},
    catalog: null,
    loadSprites,

    async loadCatalog() {
      const events = await pool.querySync(gameReadRelays(), { kinds: [SPRITE_KIND], '#t': ['silvamor'], limit: 500 }, { maxWait: 5000 })
      const sprites = events.map((e) => get().addSprite(e)).filter((s): s is Sprite => !!s)
      // The same sheet republished by someone else is a copy: list only the first.
      const firstBySheet = new Map<string, Sprite>()
      for (const s of [...sprites].sort((a, b) => a.createdAt - b.createdAt)) {
        const key = s.sha256 || s.id
        const first = firstBySheet.get(key)
        if (!first || first.author === s.author) firstBySheet.set(key, s)
      }
      const listed = [...new Set([...firstBySheet.values()].map((s) => s.id))]
      set({ catalog: listed.sort((a, b) => get().sprites[b].createdAt - get().sprites[a].createdAt) })
    },

    request(pubkey) {
      if (get().choices[pubkey] || queue.has(pubkey)) return
      queue.add(pubkey)
      timer ??= setTimeout(() => void flush(), 50)
    },

    async loadAuthor(pubkey) {
      const events = await pool.querySync(gameReadRelays(), { kinds: [SPRITE_KIND], authors: [pubkey] }, { maxWait: 4000 })
      const ids = events.map((e) => get().addSprite(e)?.id).filter((id): id is string => !!id)
      set({ byAuthor: { ...get().byAuthor, [pubkey]: [...new Set(ids)] } })
    },

    addSprite(event) {
      const sprite = parseSprite(event)
      if (!sprite) return null
      // Addressable: keep the newest version of each sprite.
      const known = get().sprites[sprite.id]
      if (known && known.createdAt > sprite.createdAt) return known
      set({ sprites: { ...get().sprites, [sprite.id]: sprite } })
      if (!get().byAuthor[event.pubkey]?.includes(sprite.id)) {
        set({ byAuthor: { ...get().byAuthor, [event.pubkey]: [...(get().byAuthor[event.pubkey] ?? []), sprite.id] } })
      }
      return sprite
    },

    async choose(signer, pubkey, id) {
      const event = await signer.signEvent(buildSpriteChoice(id))
      await publishTo(gameWriteRelays(), event)
      set({ choices: { ...get().choices, [pubkey]: { id, at: event.created_at } } })
    },
  }
})

/** The sprite a player shows: their pick once known (and loaded), else the default. */
export function usePlayerSprite(pubkey: string): Sprite {
  const id = useSprites((s) => s.choices[pubkey]?.id)
  const sprite = useSprites((s) => (id ? s.sprites[id] : undefined))
  useEffect(() => {
    useSprites.getState().request(pubkey)
  }, [pubkey])
  // Sprites by artists you hid, or reported by people you follow, stay off your screen.
  const blocked = useSpriteBlock(sprite)
  return sprite && !blocked ? sprite : DEFAULT_SPRITE
}
