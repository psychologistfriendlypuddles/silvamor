import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { Check, Download, ImageUp, Sparkles } from 'lucide-react'
import {
  ANIMATIONS,
  BUILTIN_SPRITES,
  EVENTS,
  MAX_SHEET_BYTES,
  MOODS,
  buildSprite,
  parseManifest,
  sheetSize,
  type AnimationName,
  type Sprite,
  type SpriteEvent,
  type SpriteManifest,
  type SpriteMood,
} from '../lib/sprites'
import { uploadBlob } from '../lib/blossom'
import { publishTo } from '../lib/nostr/pool'
import { useSigner } from '../stores/session'
import { usePlayerSprite, useSprites } from '../stores/sprites'
import { gameWriteRelays } from '../stores/relays'
import { toast } from '../stores/toast'
import { SpriteView, type SpriteCue } from './Sprite'
import { Button, Card, Field } from './ui'

const LABELS: Record<AnimationName, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  happy: 'Happy',
  sad: 'Sad',
  win: 'Win',
  lose: 'Lose',
  draw: 'Draw',
  strike: 'Strike',
  capture: 'Capture',
  check: 'Check',
  chat: 'Chat',
}

/** The manifest for public/sprites/template.png: edit the frame counts to match your drawing. */
const TEMPLATE_MANIFEST: SpriteManifest = {
  version: 1,
  size: 128,
  pixelated: false,
  animations: Object.fromEntries(ANIMATIONS.map((name, row) => [name, { row, frames: 4, fps: MOODS.includes(name as SpriteMood) ? 4 : 10 }])) as SpriteManifest['animations'],
}

/** A big sprite with buttons to play each of its animations. */
export function SpritePreview({ sprite, size = 128 }: { sprite: Sprite; size?: number }) {
  const [mood, setMood] = useState<SpriteMood>('idle')
  const [cue, setCue] = useState<SpriteCue | null>(null)
  const has = (name: AnimationName) => !!sprite.manifest.animations[name]
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-3xl bg-gradient-to-b from-night-800 to-night-900 p-3 ring-1 ring-white/10">
        <SpriteView sprite={sprite} mood={mood} cue={cue} size={size} />
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {MOODS.map((m) => (
          <Chip key={m} selected={mood === m} missing={!has(m)} onClick={() => setMood(m)}>
            {LABELS[m]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {EVENTS.map((e: SpriteEvent) => (
          <Chip key={e} missing={!has(e)} onClick={() => setCue({ name: e, key: Date.now() })}>
            ▶ {LABELS[e]}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function Chip({ selected, missing, onClick, children }: { selected?: boolean; missing?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={missing ? 'Not in this sprite: it falls back to another animation' : undefined}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        selected ? 'border-lemon bg-lemon/15 text-white' : 'border-white/10 text-white/60 hover:border-white/30'
      } ${missing ? 'opacity-45' : ''}`}
    >
      {children}
    </button>
  )
}

/** Profile: pick the sprite that stands in your corner of every game, or make one. */
export function SpriteCard() {
  const { signer, pubkey } = useSigner()
  const current = usePlayerSprite(pubkey)
  const mine = useSprites((s) => s.byAuthor[pubkey])
  const sprites = useSprites((s) => s.sprites)
  const [saving, setSaving] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void useSprites.getState().loadAuthor(pubkey)
  }, [pubkey])

  const choices = [...BUILTIN_SPRITES, ...(mine ?? []).map((id) => sprites[id]).filter(Boolean)]
  if (!choices.some((s) => s.id === current.id)) choices.push(current)

  const choose = async (sprite: Sprite) => {
    setSaving(sprite.id)
    try {
      await useSprites.getState().choose(signer, pubkey, sprite.id)
      toast.success(`${sprite.name} is now your sprite ✨`)
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-lemon" />
        <p className="font-semibold">Your sprite</p>
      </div>
      <p className="-mt-2 text-sm text-white/55">It stands in your corner of every game and reacts to how it's going. Everyone sees the one you pick.</p>
      <SpritePreview sprite={current} />

      <div className="flex flex-wrap gap-2">
        {choices.map((s) => (
          <motion.button
            type="button"
            key={s.id}
            whileTap={{ scale: 0.95 }}
            onClick={() => s.id !== current.id && choose(s)}
            disabled={!!saving}
            aria-label={`Use ${s.name}`}
            className={`relative flex flex-col items-center gap-1 rounded-2xl border-2 p-2 text-xs font-medium ${
              s.id === current.id ? 'border-lemon bg-lemon/10' : 'border-white/10 hover:border-white/25'
            }`}
          >
            <SpriteView sprite={s} size={56} />
            <span className="max-w-20 truncate">{s.name}</span>
            {s.id === current.id && <Check className="absolute top-1 right-1 size-4 text-lemon" />}
          </motion.button>
        ))}
      </div>

      <p className="text-sm text-white/55">
        More in the{' '}
        <Link to="/sprites" className="font-semibold text-mint hover:underline">
          sprite shop
        </Link>
        .
      </p>

      {creating ? (
        <SpriteMaker
          onDone={(sprite) => {
            setCreating(false)
            if (sprite) void choose(sprite)
          }}
        />
      ) : (
        <Button variant="secondary" icon={<ImageUp className="size-4" />} className="self-start" onClick={() => setCreating(true)}>
          Upload your own sprite
        </Button>
      )}
    </Card>
  )
}

/** Upload a sprite sheet with its manifest, check it against the standard, preview, publish. */
export function SpriteMaker({ onDone }: { onDone(sprite: Sprite | null): void }) {
  const { signer, pubkey } = useSigner()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [manifestText, setManifestText] = useState(() => JSON.stringify(TEMPLATE_MANIFEST, null, 2))
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  useEffect(() => {
    if (!preview) return
    const img = new Image()
    img.onload = () => setDims({ width: img.naturalWidth, height: img.naturalHeight })
    img.src = preview
  }, [preview])

  const check = useMemo((): { manifest?: SpriteManifest; error?: string } => {
    let manifest: SpriteManifest
    try {
      manifest = parseManifest(manifestText)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
    if (file && file.type !== 'image/png') return { manifest, error: 'The sheet must be a PNG.' }
    if (file && file.size > MAX_SHEET_BYTES) return { manifest, error: 'The sheet must be 1 MB or smaller.' }
    const need = sheetSize(manifest)
    if (dims && (dims.width < need.width || dims.height < need.height)) {
      return { manifest, error: `The manifest needs a sheet of at least ${need.width}×${need.height}px; this one is ${dims.width}×${dims.height}px.` }
    }
    return { manifest }
  }, [manifestText, file, dims])

  const draft: Sprite | null =
    preview && check.manifest && !check.error
      ? { id: 'draft', name: name || 'Draft', author: pubkey, image: preview, manifest: check.manifest, createdAt: 0 }
      : null

  const publish = async () => {
    if (!file || !check.manifest || check.error) return
    setBusy(true)
    try {
      const { url, sha256 } = await uploadBlob(file, signer)
      const event = await signer.signEvent(
        buildSprite({ d: sha256.slice(0, 16), name: name.trim() || 'My sprite', image: url, sha256, manifest: check.manifest }),
      )
      await publishTo(gameWriteRelays(), event)
      const sprite = useSprites.getState().addSprite(event)
      toast.success('Sprite published!')
      onDone(sprite)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4">
      <p className="text-sm text-white/60">
        Draw your sprite on the{' '}
        <a href="/sprites/template.png" download className="inline-flex items-center gap-1 font-semibold text-mint hover:underline">
          <Download className="size-3.5" /> template sheet
        </a>{' '}
        (one row per animation, frames left to right, facing right), then set the frame counts below. Only <b>idle</b> is required. The{' '}
        <a href="/sprites/ostrich.png" download className="font-semibold text-mint hover:underline">
          ostrich sheet
        </a>{' '}
        is a finished example.
      </p>
      <Field label="Name" placeholder="Disco duck" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-white/70">
        Sprite sheet (PNG)
        <input
          type="file"
          accept="image/png"
          aria-label="Sprite sheet"
          onChange={(e) => {
            setDims(null)
            setFile(e.target.files?.[0] ?? null)
          }}
          className="text-sm text-white/60 file:mr-3 file:rounded-xl file:border-0 file:bg-night-700 file:px-3 file:py-2 file:text-white"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-white/70">
        Manifest
        <textarea
          aria-label="Manifest"
          value={manifestText}
          onChange={(e) => setManifestText(e.target.value)}
          rows={8}
          spellCheck={false}
          className="rounded-xl border-2 border-white/10 bg-night-900 p-3 font-mono text-xs text-white/80 outline-none focus:border-grape"
        />
      </label>
      {check.error && <p className="text-sm text-rose-300">{check.error}</p>}
      {draft && <SpritePreview sprite={draft} />}
      <p className="text-xs text-white/40">Only share art you made or have permission to share. Like any picture on Nostr, anyone can see and copy it.</p>
      <div className="flex gap-2">
        <Button variant="lemon" loading={busy} disabled={!draft} onClick={publish}>
          Publish and use it
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
