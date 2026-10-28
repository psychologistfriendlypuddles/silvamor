import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Bitcoin, Send } from 'lucide-react'
import { Button, Card, Spinner } from './ui'
import { Avatar } from './Avatar'
import { SpriteView } from './Sprite'
import { PlayerSheet } from './PlayerSheet'
import { Modal } from './Modal'
import { usePlayerSprite } from '../stores/sprites'
import { toast } from '../stores/toast'
import { useSigner } from '../stores/session'
import { useRelays, writeRelays } from '../stores/relays'
import { useDisplayName } from '../hooks/useDisplayName'
import { publishTo } from '../lib/nostr/pool'
import type { Block } from '../lib/bitcoin'
import { fetchDayBlock, untilNextDay } from '../games/day'

// What Silvamor's daily games share: waiting for the day's seed block, ranked boards (podium or
// list), and the offer to share your result as a note.

/**
 * Finds the day's seed block (the first Bitcoin block after midnight UTC), then shows `children`
 * with it; meanwhile a waiting card that says what `seeds` (e.g. "Today's deck is shuffled").
 */
export function DayBlock({ day, seeds, children }: { day: string; seeds: string; children(block: Block): ReactNode }) {
  // The seed block: undefined while asking, null until it's mined.
  const [block, setBlock] = useState<Block | null | undefined>(undefined)
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let cancelled = false
    const look = () =>
      fetchDayBlock(day)
        .then((b) => {
          if (cancelled) return
          setBlock(b)
          setUnreachable(false)
          if (!b) timer = setTimeout(look, 60_000)
        })
        .catch(() => {
          if (cancelled) return
          setUnreachable(true)
          timer = setTimeout(look, 60_000)
        })
    look()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [day])

  if (block) return children(block)
  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center gap-3 py-10 text-center">
      {unreachable ? <Bitcoin className="size-10 text-tangerine" /> : <Spinner />}
      <p className="font-medium text-white/80">
        {unreachable ? "Can't reach a Bitcoin block source" : block === null ? "Waiting for today's first Bitcoin block" : 'Finding today’s game…'}
      </p>
      <p className="max-w-xs text-sm text-white/50">{seeds} by the first Bitcoin block after midnight UTC, so nobody can see it coming. That's usually within 10 minutes.</p>
    </Card>
  )
}

/** "A new <what> in 5h 12m", ticking. */
export function NextDay({ what }: { what: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const minutes = Math.ceil(untilNextDay(now) / 60_000)
  return (
    <p className="text-sm text-white/50">
      A new {what} in {Math.floor(minutes / 60)}h {minutes % 60}m
    </p>
  )
}

/**
 * Offers to post the result as a public note on the player's own relays, editable first. The note
 * carries `hashtag` as a `t` tag too, so the Social feed finds it however the text is edited.
 */
export function SharePrompt({ open, text, hashtag, onClose }: { open: boolean; text(): string; hashtag: string; onClose(): void }) {
  return (
    <Modal open={open} onClose={onClose}>
      {open && <ShareForm initial={text()} hashtag={hashtag} onClose={onClose} />}
    </Modal>
  )
}

function ShareForm({ initial, hashtag, onClose }: { initial: string; hashtag: string; onClose(): void }) {
  const { signer } = useSigner()
  const relays = useRelays((s) => s.relays)
  const [note, setNote] = useState(initial)
  const [posting, setPosting] = useState(false)

  const post = async () => {
    setPosting(true)
    try {
      const event = await signer.signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', hashtag]], content: note.trim() })
      // Silvamor's relay doesn't keep notes, so this only reaches the player's own relays.
      const ok = await publishTo(writeRelays(relays), event).catch(() => {
        throw new Error("None of your relays took the note. Add a relay you write to on the Relays page (Silvamor's relay doesn't keep notes).")
      })
      toast.success(`Shared to ${ok.length} relay${ok.length === 1 ? '' : 's'} 🎉`)
      onClose()
    } catch (err) {
      toast.error(err)
      setPosting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-display">Share your score?</h2>
      <p className="text-sm text-white/60">Post it as a note on Nostr, so your followers see it in any Nostr app.</p>
      <textarea
        aria-label="Your note"
        rows={5}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full resize-none rounded-2xl border-2 border-white/10 bg-night-950/60 px-4 py-3 text-white outline-none focus:border-grape"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={posting} onClick={onClose}>
          Not now
        </Button>
        <Button loading={posting} disabled={!note.trim()} icon={<Send className="size-4" />} onClick={post}>
          Post to Nostr
        </Button>
      </div>
    </div>
  )
}

/** A ranked player: who, and what they're ranked by, already written ("12,345 sats", "🔥 9 days"). */
export interface Ranked {
  author: string
  value: string
  streak?: number
}

/**
 * The top three on a podium (gold, silver, bronze, with their sprites), then everyone else as a
 * list. Tapping a player opens their profile, to tip them.
 */
export function PodiumBoard({ rows, me, empty }: { rows: Ranked[]; me: string; empty: string }) {
  const [viewing, setViewing] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && <p className="py-6 text-center text-sm text-white/45">{empty}</p>}
      <ol className="grid grid-cols-3 items-end gap-2 pt-2" aria-label="Podium">
        {rows.slice(0, 3).map((row, i) => (
          <li key={row.author} className={`row-start-1 ${PLACES[i].column}`}>
            <Step row={row} place={PLACES[i]} me={row.author === me} onOpen={setViewing} />
          </li>
        ))}
      </ol>
      {rows.length > 3 && (
        <ol className="flex flex-col gap-1.5" aria-label="Everyone else">
          {rows.slice(3).map((row, i) => (
            <ScoreRow key={row.author} rank={i + 4} author={row.author} me={row.author === me} onOpen={setViewing} value={row.value} streak={row.streak ?? 1} />
          ))}
        </ol>
      )}
      <PlayerSheet pubkey={viewing} tipping onClose={() => setViewing(null)} />
    </div>
  )
}

/** Players ranked as a list, e.g. a league's standings. Tapping a player opens their profile. */
export function RankedList({ rows, me, empty }: { rows: Ranked[]; me: string; empty: string }) {
  const [viewing, setViewing] = useState<string | null>(null)
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-white/45">{empty}</p>
  return (
    <>
      <ol className="flex flex-col gap-1.5" aria-label="Standings">
        {rows.map((row, i) => (
          <ScoreRow key={row.author} rank={i + 1} author={row.author} me={row.author === me} onOpen={setViewing} value={row.value} streak={row.streak ?? 1} />
        ))}
      </ol>
      <PlayerSheet pubkey={viewing} tipping onClose={() => setViewing(null)} />
    </>
  )
}

/** Gold, silver and bronze. Listed in rank order; each stands in its own column: second, first, third. */
const PLACES = [
  { rank: 1, column: 'col-start-2', height: 'h-24', block: 'bg-lemon text-night-900', sprite: 88 },
  { rank: 2, column: 'col-start-1', height: 'h-16', block: 'bg-slate-300/80 text-night-900', sprite: 72 },
  { rank: 3, column: 'col-start-3', height: 'h-12', block: 'bg-tangerine/80 text-night-900', sprite: 72 },
]

function Step({ row, place, me, onOpen }: { row: Ranked; place: (typeof PLACES)[number]; me: boolean; onOpen(pubkey: string): void }) {
  const sprite = usePlayerSprite(row.author)
  const name = useDisplayName(row.author)
  return (
    <button onClick={() => onOpen(row.author)} aria-label={`${place.rank}. ${me ? 'You' : name}: ${row.value}`} className="flex w-full min-w-0 flex-col items-center gap-1">
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 * (3 - place.rank), type: 'spring', stiffness: 300, damping: 18 }}>
        <SpriteView sprite={sprite} mood={place.rank === 1 ? 'win' : 'happy'} size={place.sprite} />
      </motion.div>
      <span className="w-full truncate text-center text-sm font-semibold">{me ? 'You' : name}</span>
      <span className="font-display text-lemon">{row.value}</span>
      {row.streak !== undefined && <Streak days={row.streak} />}
      <span className={`flex w-full items-start justify-center rounded-t-xl pt-1 text-2xl font-display ${place.height} ${place.block}`}>{place.rank}</span>
    </button>
  )
}

function ScoreRow({ rank, author, me, onOpen, value, streak }: { rank: number; author: string; me: boolean; onOpen(pubkey: string): void; value: string; streak: number }) {
  const name = useDisplayName(author)
  return (
    <li>
      <button
        onClick={() => onOpen(author)}
        aria-label={`${rank}. ${me ? 'You' : name}: ${value}`}
        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${me ? 'bg-grape/20 ring-1 ring-grape/40' : 'bg-night-950/60 hover:bg-night-950/80'}`}
      >
        <span className="w-6 text-center font-display text-white/50">{rank}</span>
        <Avatar pubkey={author} className="size-8 text-xs" />
        <span className="min-w-0 flex-1 truncate font-medium">{me ? 'You' : name}</span>
        <Streak days={streak} />
        <span className="font-display text-lemon">{value}</span>
      </button>
    </li>
  )
}

/** Days in a row played, from two on. */
function Streak({ days }: { days: number }) {
  if (days < 2) return null
  return (
    <span className="text-xs font-semibold text-tangerine" aria-label={`${days}-day streak`}>
      🔥 {days}
    </span>
  )
}
