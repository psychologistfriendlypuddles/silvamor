import type { Event, EventTemplate } from 'nostr-tools/pure'

// Player sprites (docs/SPRITES.md): one PNG sheet, one row per animation, frames left to
// right, described by a small JSON manifest. Sprites are published as Nostr events so any
// client can show the sprite a player picked.

export const SPRITE_KIND = 30951
/** NIP-78 app data: which sprite a player uses. */
export const APP_DATA_KIND = 30078
export const SPRITE_CHOICE_D = 'silvamor/sprite'

/** Looping reactions to the state of the game. */
export const MOODS = ['idle', 'thinking', 'happy', 'sad', 'win', 'lose', 'draw'] as const
/** One-shot reactions to something that just happened; the mood resumes afterwards. */
export const EVENTS = ['strike', 'capture', 'check', 'chat'] as const
export type SpriteMood = (typeof MOODS)[number]
export type SpriteEvent = (typeof EVENTS)[number]
export type AnimationName = SpriteMood | SpriteEvent
export const ANIMATIONS: readonly AnimationName[] = [...MOODS, ...EVENTS]

/** What a missing mood falls back to (idle is required, so every chain ends there). */
export const MOOD_FALLBACK: Record<SpriteMood, SpriteMood | null> = {
  idle: null,
  thinking: 'idle',
  happy: 'idle',
  sad: 'idle',
  win: 'happy',
  lose: 'sad',
  draw: 'idle',
}

export const MIN_FRAME = 32
export const MAX_FRAME = 256
export const MAX_FRAMES_PER_ROW = 16
/** One row per animation name at most: rows 0 to 10. */
export const MAX_ROWS = ANIMATIONS.length
export const MAX_FPS = 30
export const MAX_SHEET_BYTES = 1024 * 1024

export interface SpriteAnimation {
  row: number
  frames: number
  fps: number
}

export interface SpriteManifest {
  version: 1
  /** Frames are square, this many pixels a side. */
  size: number
  /** Scale up with hard edges (pixel art) instead of smoothing. */
  pixelated?: boolean
  animations: Partial<Record<AnimationName, SpriteAnimation>> & { idle: SpriteAnimation }
}

export interface Sprite {
  /** "builtin:<name>" or the sprite event's coordinate (30951:<pubkey>:<d>). */
  id: string
  name: string
  author: string | null
  image: string
  /** sha256 of the sheet, when published (lets clients check a Blossom copy). */
  sha256?: string
  manifest: SpriteManifest
  /** When this version of the sprite event was published (0 for built-ins). */
  createdAt: number
}

const isInt = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max

/** Checks a manifest against the standard; returns it typed, or throws saying what's wrong. */
export function parseManifest(value: unknown): SpriteManifest {
  const m = (typeof value === 'string' ? JSON.parse(value) : value) as Partial<SpriteManifest> | null
  if (!m || typeof m !== 'object') throw new Error('The manifest must be a JSON object.')
  if (m.version !== 1) throw new Error('Unsupported manifest version (expected 1).')
  if (!isInt(m.size, MIN_FRAME, MAX_FRAME)) throw new Error(`"size" must be a whole number of pixels from ${MIN_FRAME} to ${MAX_FRAME}.`)
  if (!m.animations || typeof m.animations !== 'object') throw new Error('"animations" is missing.')
  const animations: Partial<Record<AnimationName, SpriteAnimation>> = {}
  const rows = new Set<number>()
  for (const [name, a] of Object.entries(m.animations)) {
    if (!(ANIMATIONS as readonly string[]).includes(name)) throw new Error(`Unknown animation "${name}".`)
    if (!a || !isInt(a.row, 0, MAX_ROWS - 1) || !isInt(a.frames, 1, MAX_FRAMES_PER_ROW) || !isInt(a.fps, 1, MAX_FPS)) {
      throw new Error(`"${name}" needs a row from 0 to ${MAX_ROWS - 1}, 1-${MAX_FRAMES_PER_ROW} frames and 1-${MAX_FPS} fps.`)
    }
    if (rows.has(a.row)) throw new Error(`Two animations share row ${a.row}.`)
    rows.add(a.row)
    animations[name as AnimationName] = { row: a.row, frames: a.frames, fps: a.fps }
  }
  if (!animations.idle) throw new Error('Every sprite needs an "idle" animation.')
  return { version: 1, size: m.size, pixelated: m.pixelated === true, animations: animations as SpriteManifest['animations'] }
}

/** The sheet size a manifest needs: as wide as the longest animation, as tall as the last row. */
export function sheetSize(m: SpriteManifest) {
  const all = Object.values(m.animations)
  return { width: m.size * Math.max(...all.map((a) => a.frames)), height: m.size * (Math.max(...all.map((a) => a.row)) + 1) }
}

/**
 * Whether a sheet of `width`×`height` pixels suits its manifest: big enough for its animations, and
 * no bigger than the standard allows at its frame size (16 frames by 11 rows), so no sprite can make
 * a phone decode a huge picture.
 */
export function sheetFits(m: SpriteManifest, width: number, height: number) {
  const need = sheetSize(m)
  return width >= need.width && height >= need.height && width <= m.size * MAX_FRAMES_PER_ROW && height <= m.size * MAX_ROWS
}

/** The animation to play for a mood, following fallbacks for moods the sprite doesn't have. */
export function animationFor(m: SpriteManifest, mood: SpriteMood): SpriteAnimation {
  for (let name: SpriteMood | null = mood; name; name = MOOD_FALLBACK[name]) {
    const a = m.animations[name]
    if (a) return a
  }
  return m.animations.idle
}

// --- The starter sprite, shipped with the app (scripts/sprites/ostrich.mjs draws it) ---

export const OSTRICH: Sprite = {
  id: 'builtin:ostrich',
  name: 'Ostrich',
  author: null,
  image: '/sprites/ostrich.png',
  createdAt: 0,
  manifest: {
    version: 1,
    size: 64,
    pixelated: true,
    animations: {
      idle: { row: 0, frames: 4, fps: 4 },
      thinking: { row: 1, frames: 4, fps: 4 },
      happy: { row: 2, frames: 4, fps: 8 },
      sad: { row: 3, frames: 4, fps: 4 },
      win: { row: 4, frames: 6, fps: 10 },
      lose: { row: 5, frames: 4, fps: 4 },
      draw: { row: 6, frames: 4, fps: 4 },
      strike: { row: 7, frames: 6, fps: 10 },
      capture: { row: 8, frames: 6, fps: 12 },
      check: { row: 9, frames: 6, fps: 10 },
      chat: { row: 10, frames: 4, fps: 8 },
    },
  },
}
export const BUILTIN_SPRITES = [OSTRICH]
export const DEFAULT_SPRITE = OSTRICH

// --- Nostr events ---

const tag = (e: Event, name: string) => e.tags.find((t) => t[0] === name)?.[1]

/** Only https sheets (or same-site paths for local testing) are loaded. */
export function safeImageUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const origin = typeof location === 'undefined' ? 'https://silvamor.invalid' : location.origin
    const u = new URL(url, origin)
    return u.protocol === 'https:' || u.origin === origin || u.hostname === 'localhost' ? u.href : null
  } catch {
    return null
  }
}

export function parseSprite(e: Event): Sprite | null {
  if (e.kind !== SPRITE_KIND) return null
  const image = safeImageUrl(tag(e, 'image'))
  if (!image) return null
  try {
    const manifest = parseManifest(e.content)
    return {
      id: `${SPRITE_KIND}:${e.pubkey}:${tag(e, 'd') ?? ''}`,
      name: (tag(e, 'title') ?? 'Untitled').slice(0, 60),
      author: e.pubkey,
      image,
      sha256: tag(e, 'x'),
      manifest,
      createdAt: e.created_at,
    }
  } catch {
    return null
  }
}

export function buildSprite(f: { d: string; name: string; image: string; sha256: string; manifest: SpriteManifest }): EventTemplate {
  return {
    kind: SPRITE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify(f.manifest),
    tags: [
      ['d', f.d],
      ['title', f.name],
      ['image', f.image],
      ['x', f.sha256],
      ['m', 'image/png'],
      ['t', 'silvamor'],
      ['alt', `Silvamor player sprite: ${f.name}`],
    ],
  }
}


/** A player's pick: a built-in sprite by id, or a published sprite by its coordinate. */
export function buildSpriteChoice(id: string): EventTemplate {
  return {
    kind: APP_DATA_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [['d', SPRITE_CHOICE_D], id.startsWith('builtin:') ? ['sprite', id] : ['a', id], ['alt', 'Silvamor sprite choice']],
  }
}

export function parseSpriteChoice(e: Event): string | null {
  if (e.kind !== APP_DATA_KIND || tag(e, 'd') !== SPRITE_CHOICE_D) return null
  const a = tag(e, 'a')
  if (a?.startsWith(`${SPRITE_KIND}:`)) return a
  const builtin = tag(e, 'sprite')
  return BUILTIN_SPRITES.some((s) => s.id === builtin) ? builtin! : null
}
