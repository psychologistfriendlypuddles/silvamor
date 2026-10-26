import { useEffect, useState } from 'react'
import type { SpriteCue } from '../components/Sprite'
import type { SpriteEvent } from '../lib/sprites'

/** Events keep streaming in from relays for a moment after a game opens; that's history, not news. */
const SETTLE_MS = 3000

export type CueCounts = Record<SpriteEvent, number>

/**
 * A one-shot sprite cue for whichever count (strikes, captures, checks, chat messages)
 * went up most recently, ignoring what was already there when the game opened.
 */
export function useSpriteCue(counts: CueCounts): SpriteCue | null {
  const [settled, setSettled] = useState(false)
  const [prev, setPrev] = useState(counts)
  const [cue, setCue] = useState<SpriteCue | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS)
    return () => clearTimeout(t)
  }, [])
  const names = Object.keys(counts) as SpriteEvent[]
  if (names.some((n) => counts[n] !== prev[n])) {
    // Adjusting state while rendering, from the previous counts (react.dev, "you might not need an effect").
    const up = names.find((n) => counts[n] > prev[n])
    setPrev(counts)
    if (settled && up) setCue({ name: up, key: `${up}:${counts[up]}` })
  }
  return cue
}
