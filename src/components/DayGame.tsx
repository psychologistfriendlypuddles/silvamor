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
import { fetchDayBlock, untilNextDeal } from '../games/dailydeal/daily'

// What Silvamor's daily games share: waiting for the day's seed block, the leaderboard of people
// you follow and your groups, and the offer to share your result as a note.

/** A run that counts, as leaderboards need it. */
export interface RankedRun {
  author: string
  score: number
  createdAt: number
}

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
  const minutes = Math.ceil(untilNextDeal(now) / 60_000)
  return (
    <p className="text-sm text-white/50">
      A new {what} in {Math.floor(minutes / 60)}h {minutes % 60}m
    </p>
  )
}

/** Offers to post the result as a public note on the player's own relays, editable first. */
export function SharePrompt({ open, text, onClose }: { open: boolean; text(): string; onClose(): void }) {
  return (
    <Modal open={open} onClose={onClose}>
      {open && <ShareForm initial={text()} onClose={onClose} />}
    </Modal>
  )
}

function ShareForm({ initial, onClose }: { initial: string; onClose(): void }) {
  const { signer } = useSigner()
  const relays = useRelays((s) => s.relays)
  const [note, setNote] = useState(initial)
  const [posting, setPosting] = useState(false)

  const post = async () => {
    setPosting(true)
    try {
      const event = await signer.signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: note.trim() })
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

/**
 * Today's scores among the people you follow, or one of your groups, you included: a podium, then
 * everyone else. `format` writes a score; `streakOf` gives a run's streak, for games that have them.
 */
export function Leaderboard<R extends RankedRun>({
  runs,
  me,
  follows,
  groups,
  format = (n) => n.toLocaleString(),
  streakOf,
}: {
  runs: Map<string, R>
  me: string
  follows: string[]
  groups: { id: string; title: string; members: string[] }[]
  format?(score: number): string
  streakOf?(run: R): number
}) {
  const tabs = [{ id: 'following', title: 'Following', members: follows }, ...[...groups].sort((a, b) => a.title.localeCompare(b.title))]
  const [tab, setTab] = useState('following')
  const [viewing, setViewing] = useState<string | null>(null)
  const members = new Set([me, ...(tabs.find((t) => t.id === tab) ?? tabs[0]).members])
  const rows = [...runs.values()].filter((r) => members.has(r.author)).sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
  const streak = (run: R) => streakOf?.(run) ?? 1

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wider text-white/50 uppercase">Today's scores</h2>
      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-sm font-semibold ${t.id === tab ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}
          >
            {t.title}
          </button>
        ))}
      </div>
      <ol className="grid grid-cols-3 items-end gap-2 pt-2" aria-label="Podium">
        {rows.slice(0, 3).map((run, i) => (
          <li key={run.author} className={`row-start-1 ${PLACES[i].column}`}>
            <Step run={run} place={PLACES[i]} me={run.author === me} onOpen={setViewing} streak={streak(run)} format={format} />
          </li>
        ))}
      </ol>
      {rows.length > 3 && (
        <ol className="flex flex-col gap-1.5" aria-label="Everyone else">
          {rows.slice(3).map((run, i) => (
            <ScoreRow key={run.author} rank={i + 4} run={run} me={run.author === me} onOpen={setViewing} streak={streak(run)} format={format} />
          ))}
        </ol>
      )}
      {rows.length <= 1 && <p className="text-center text-sm text-white/45">Nobody else here has played today yet.</p>}
      <PlayerSheet pubkey={viewing} tipping onClose={() => setViewing(null)} />
    </Card>
  )
}

/** Gold, silver and bronze. Listed in rank order; each stands in its own column: second, first, third. */
const PLACES = [
  { rank: 1, column: 'col-start-2', height: 'h-24', block: 'bg-lemon text-night-900', sprite: 88 },
  { rank: 2, column: 'col-start-1', height: 'h-16', block: 'bg-slate-300/80 text-night-900', sprite: 72 },
  { rank: 3, column: 'col-start-3', height: 'h-12', block: 'bg-tangerine/80 text-night-900', sprite: 72 },
]

type RowProps = { run: RankedRun; me: boolean; onOpen(pubkey: string): void; streak: number; format(score: number): string }

function Step({ run, place, me, onOpen, streak, format }: RowProps & { place: (typeof PLACES)[number] }) {
  const sprite = usePlayerSprite(run.author)
  const name = useDisplayName(run.author)
  return (
    <button onClick={() => onOpen(run.author)} aria-label={`${place.rank}. ${me ? 'You' : name}: ${format(run.score)}`} className="flex w-full min-w-0 flex-col items-center gap-1">
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 * (3 - place.rank), type: 'spring', stiffness: 300, damping: 18 }}>
        <SpriteView sprite={sprite} mood={place.rank === 1 ? 'win' : 'happy'} size={place.sprite} />
      </motion.div>
      <span className="w-full truncate text-center text-sm font-semibold">{me ? 'You' : name}</span>
      <span className="font-display text-lemon">{format(run.score)}</span>
      <Streak days={streak} />
      <span className={`flex w-full items-start justify-center rounded-t-xl pt-1 text-2xl font-display ${place.height} ${place.block}`}>{place.rank}</span>
    </button>
  )
}

function ScoreRow({ rank, run, me, onOpen, streak, format }: RowProps & { rank: number }) {
  const name = useDisplayName(run.author)
  return (
    <li>
      <button
        onClick={() => onOpen(run.author)}
        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${me ? 'bg-grape/20 ring-1 ring-grape/40' : 'bg-night-950/60 hover:bg-night-950/80'}`}
      >
        <span className="w-6 text-center font-display text-white/50">{rank}</span>
        <Avatar pubkey={run.author} className="size-8 text-xs" />
        <span className="min-w-0 flex-1 truncate font-medium">{me ? 'You' : name}</span>
        <Streak days={streak} />
        <span className="font-display text-lemon">{format(run.score)}</span>
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
