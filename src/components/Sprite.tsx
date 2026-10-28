import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SPRITE, animationFor, sheetFits, type Sprite, type SpriteAnimation, type SpriteEvent, type SpriteManifest, type SpriteMood } from '../lib/sprites'

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Each sheet's size in pixels, read once per address; null if it doesn't load. */
const sheetSizes = new Map<string, Promise<{ width: number; height: number } | null>>()

/**
 * A sheet's size, read from a detached image: the browser downloads it but doesn't decode it until
 * it's shown, so a huge picture can be turned away before it costs a phone its memory.
 */
function measure(url: string) {
  let size = sheetSizes.get(url)
  if (!size) {
    size = new Promise((resolve) => {
      const probe = new Image()
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
      probe.onerror = () => resolve(null)
      probe.src = url
    })
    sheetSizes.set(url, size)
  }
  return size
}

/** Whether a sprite's sheet loads and suits its manifest (`sheetFits`); null while that's checked. Built-ins are trusted. */
function useSheetFits({ author, image, manifest }: Sprite): boolean | null {
  const [checked, setChecked] = useState<{ image: string; manifest: SpriteManifest; fits: boolean } | null>(null)
  useEffect(() => {
    if (!author) return
    let live = true
    measure(image).then((size) => live && setChecked({ image, manifest, fits: !!size && sheetFits(manifest, size.width, size.height) }))
    return () => {
      live = false
    }
  }, [author, image, manifest])
  if (!author) return true
  return checked?.image === image && checked.manifest === manifest ? checked.fits : null
}

/** A one-shot reaction; a new `key` plays it again. */
export interface SpriteCue {
  name: SpriteEvent
  key: string | number
}

/**
 * Plays a sprite sheet: the mood loops, and a cue (strike, capture, …) plays once over it.
 * `mirror` flips it to face left (sprites are drawn facing right).
 */
export function SpriteView({
  sprite,
  mood = 'idle',
  cue,
  size,
  mirror = false,
  className = '',
}: {
  sprite: Sprite
  mood?: SpriteMood
  cue?: SpriteCue | null
  size: number
  mirror?: boolean
  className?: string
}) {
  // Sheets that fail to load, or don't suit their manifest, fall back to the default. Nothing shows
  // while that's checked.
  const fits = useSheetFits(sprite)
  const [broken, setBroken] = useState<string | null>(null)
  const shown = fits === false || broken === sprite.image ? DEFAULT_SPRITE : sprite
  const [doneCue, setDoneCue] = useState<string | number | null>(null)
  const cueAnimation = cue && cue.key !== doneCue ? shown.manifest.animations[cue.name] : undefined
  const animation = cueAnimation ?? animationFor(shown.manifest, mood)
  const name = cueAnimation ? cue!.name : mood

  return (
    <div
      role="img"
      aria-label={`${shown.name} (${name})`}
      className={`relative shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, transform: mirror ? 'scaleX(-1)' : undefined }}
    >
      {fits !== null && (
        <Frames
          // Remount per animation so each starts from its first frame.
          key={`${shown.id}|${name}|${cueAnimation ? cue!.key : ''}`}
          sprite={shown}
          animation={animation}
          once={!!cueAnimation}
          size={size}
          onDone={() => cue && setDoneCue(cue.key)}
          onBroken={() => setBroken(sprite.image)}
        />
      )}
    </div>
  )
}

function Frames({
  sprite,
  animation,
  once,
  size,
  onDone,
  onBroken,
}: {
  sprite: Sprite
  animation: SpriteAnimation
  once: boolean
  size: number
  onDone(): void
  onBroken(): void
}) {
  const [frame, setFrame] = useState(0)
  // Parents re-render often (block clock, chat); keep the timer running through that.
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])
  useEffect(() => {
    if (reducedMotion() && !once) return
    const t = setInterval(() => {
      setFrame((f) => {
        if (f + 1 < animation.frames) return f + 1
        if (once) {
          clearInterval(t)
          queueMicrotask(() => done.current())
          return f
        }
        return 0
      })
    }, 1000 / animation.fps)
    return () => clearInterval(t)
  }, [animation, once])

  const m = sprite.manifest.size
  const scale = size / m
  return (
    <img
      src={sprite.image}
      alt=""
      draggable={false}
      onError={onBroken}
      className="absolute top-0 left-0 max-w-none select-none"
      style={{
        // Natural size, scaled: translate (in sheet pixels) runs first, then the scale.
        transform: `scale(${scale}) translate(${-frame * m}px, ${-animation.row * m}px)`,
        transformOrigin: '0 0',
        imageRendering: sprite.manifest.pixelated ? 'pixelated' : 'auto',
      }}
    />
  )
}
