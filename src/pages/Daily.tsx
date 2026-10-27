import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Bitcoin, RotateCw, Send } from 'lucide-react'
import { Button, Card, PageTitle, Spinner } from '../components/ui'
import { Avatar } from '../components/Avatar'
import { SpriteView } from '../components/Sprite'
import { PlayerSheet } from '../components/PlayerSheet'
import { usePlayerSprite } from '../stores/sprites'
import type { Sprite } from '../lib/sprites'
import { toast } from '../stores/toast'
import { useSigner } from '../stores/session'
import { useGroups } from '../stores/groups'
import { gameWriteRelays, useRelays, writeRelays } from '../stores/relays'
import { Modal } from '../components/Modal'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { useDailyRuns } from '../hooks/useDailyRuns'
import { useDisplayName } from '../hooks/useDisplayName'
import { publishTo } from '../lib/nostr/pool'
import { buildRun, type DailyRun } from '../lib/nostr/dailyRuns'
import type { Block } from '../lib/bitcoin'
import { DailyDealBoard, ScoreLine } from '../games/dailydeal/Board'
import { dailyDealRules, type DailyDealMove, type DailyDealState } from '../games/dailydeal/rules'
import { markShareOffered, shareOffered, shareText } from '../games/dailydeal/share'
import { dayOf, fetchDayBlock, loadMoves, saveMoves, seedFor, untilNextDeal } from '../games/dailydeal/daily'

type Rules = ReturnType<typeof dailyDealRules>

/** Replays saved moves, keeping the ones that still apply (a bad save just ends early). */
function restore(rules: Rules, pubkey: string, seed: string): DailyDealMove[] {
  const moves: DailyDealMove[] = []
  let state = rules.init()
  for (const raw of loadMoves(pubkey, seed)) {
    try {
      const move = rules.parseMove(raw)
      state = rules.apply(state, move)
      moves.push(move)
    } catch {
      break
    }
  }
  return moves
}

/** Every state of a run, so the end screen can list each hand played. */
const statesOf = (rules: Rules, moves: unknown[]) =>
  moves.reduce<DailyDealState[]>((all, m) => [...all, rules.apply(all[all.length - 1], rules.parseMove(m))], [rules.init()])

export function DailyPage() {
  const { pubkey } = useSigner()
  const [day] = useState(() => dayOf(new Date()))
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

  return (
    <div>
      <PageTitle emoji="🃏" title="Daily Deal" subtitle={`Everyone gets the same cards and perks today (${day}). Make your hands count.`} />
      {block ? (
        // Keyed by account, so switching logins starts that account's own run.
        <Run key={pubkey} day={day} block={block} />
      ) : (
        <Card className="mx-auto flex max-w-xl flex-col items-center gap-3 py-10 text-center">
          {unreachable ? <Bitcoin className="size-10 text-tangerine" /> : <Spinner />}
          <p className="font-medium text-white/80">
            {unreachable ? "Can't reach a Bitcoin block source" : block === null ? "Waiting for today's first Bitcoin block" : 'Finding today’s deal…'}
          </p>
          <p className="max-w-xs text-sm text-white/50">Today's deck is shuffled by the first Bitcoin block after midnight UTC, so nobody can see it coming. That's usually within 10 minutes.</p>
        </Card>
      )}
    </div>
  )
}

function Run({ day, block }: { day: string; block: Block }) {
  const { signer, pubkey } = useSigner()
  useLoadGroups()
  const follows = useGroups((s) => s.follows)
  const groups = useGroups((s) => s.groups)
  const followsLoaded = useGroups((s) => s.loaded)
  const everyone = useMemo(() => [pubkey, ...follows, ...Object.values(groups).flatMap((g) => g.members)], [pubkey, follows, groups])
  const { runs, loaded, add } = useDailyRuns(day, block, everyone)
  const mine: DailyRun | undefined = runs.get(pubkey)
  const sprite = usePlayerSprite(pubkey)

  const seed = useMemo(() => seedFor(day, block.hash), [day, block])
  const rules = useMemo(() => dailyDealRules(seed), [seed])
  const [moves, setMoves] = useState(() => restore(rules, pubkey, seed))
  const states = useMemo(() => statesOf(rules, moves), [rules, moves])
  const state = states[states.length - 1]
  const finished = !!rules.outcome(state)

  // Publish the run once it's over: only the first one counts, so never twice.
  const [publishing, setPublishing] = useState<'idle' | 'busy' | 'failed'>('idle')
  // Once this device has published the run, offer to share it.
  const [sharing, setSharing] = useState(false)
  const started = useRef(false)
  const publish = async () => {
    setPublishing('busy')
    try {
      // Friends whose score this beats get a notification.
      const beaten = follows.filter((p) => p !== pubkey && (runs.get(p)?.score ?? Infinity) < state.score)
      const event = await signer.signEvent(buildRun({ day, block, moves, score: state.score, beaten }))
      await publishTo(gameWriteRelays(), event)
      add(event)
      setPublishing('idle')
      if (!shareOffered(pubkey, day)) setSharing(true)
    } catch (err) {
      setPublishing('failed')
      toast.error(err)
    }
  }
  useEffect(() => {
    if (!finished || !followsLoaded || !loaded || mine || started.current) return
    started.current = true
    publish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, followsLoaded, loaded, mine])

  const onMove = (move: DailyDealMove) => {
    try {
      rules.apply(state, move)
    } catch (err) {
      toast.error(err)
      return
    }
    const next = [...moves, move]
    setMoves(next)
    saveMoves(pubkey, seed, next)
  }

  // A published run (maybe from another device) is the one that counts.
  const shown = mine ? statesOf(rules, mine.moves) : finished ? states : null
  const others = [...runs.keys()].filter((p) => p !== pubkey).length

  if (!shown) {
    return (
      <div className="flex flex-col gap-4">
        <DailyDealBoard state={state} sprite={sprite} onMove={onMove} />
        {others > 0 && (
          <p className="text-center text-sm text-white/50">
            {others === 1 ? '1 friend has' : `${others} friends have`} played today. Finish your run to see the scores.
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Summary states={shown} sprite={sprite} />
      {!mine && (
        <p className="flex items-center justify-center gap-2 text-sm text-white/60">
          {publishing === 'failed' ? (
            <Button variant="secondary" icon={<RotateCw className="size-4" />} onClick={publish}>
              Publish my score
            </Button>
          ) : (
            <>
              <Spinner className="size-4" /> Publishing your score…
            </>
          )}
        </p>
      )}
      <Leaderboard runs={runs} me={pubkey} follows={follows} groups={Object.values(groups)} />
      <ShareRun
        open={sharing}
        text={() => shareText(day, shown[shown.length - 1].score, shown.flatMap((s) => (s.last && 'play' in s.last ? [s.last.play] : [])), location.origin)}
        onClose={() => {
          markShareOffered(pubkey, day)
          setSharing(false)
        }}
      />
    </div>
  )
}

/** Offers to post the result as a public note on the player's own relays, editable first. */
function ShareRun({ open, text, onClose }: { open: boolean; text(): string; onClose(): void }) {
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

function Summary({ states, sprite }: { states: DailyDealState[]; sprite: Sprite }) {
  const final = states[states.length - 1]
  const plays = states.flatMap((s) => (s.last && 'play' in s.last ? [s.last.play] : []))
  return (
    <Card initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 text-center">
      <SpriteView sprite={sprite} mood="win" size={96} />
      <p className="text-sm font-semibold tracking-wider text-white/50 uppercase">Run complete</p>
      <motion.p
        initial={{ scale: 0.5 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="text-5xl font-display text-lemon"
        aria-label="Final score"
      >
        {final.score.toLocaleString()}
      </motion.p>
      <ol className="flex w-full flex-col gap-1.5" aria-label="Hands played">
        {plays.map((play, i) => (
          <li key={i} className="rounded-2xl bg-night-950/60 px-4 py-2">
            <ScoreLine play={play} />
          </li>
        ))}
      </ol>
      <NextDeal />
    </Card>
  )
}

function NextDeal() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const minutes = Math.ceil(untilNextDeal(now) / 60_000)
  return (
    <p className="text-sm text-white/50">
      A new deal in {Math.floor(minutes / 60)}h {minutes % 60}m
    </p>
  )
}

function Leaderboard({ runs, me, follows, groups }: { runs: Map<string, DailyRun>; me: string; follows: string[]; groups: { id: string; title: string; members: string[] }[] }) {
  const tabs = [{ id: 'following', title: 'Following', members: follows }, ...[...groups].sort((a, b) => a.title.localeCompare(b.title))]
  const [tab, setTab] = useState('following')
  const [viewing, setViewing] = useState<string | null>(null)
  const members = new Set([me, ...(tabs.find((t) => t.id === tab) ?? tabs[0]).members])
  const rows = [...runs.values()].filter((r) => members.has(r.author)).sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)

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
      <Podium top={rows.slice(0, 3)} me={me} onOpen={setViewing} />
      {rows.length > 3 && (
        <ol className="flex flex-col gap-1.5" aria-label="Everyone else">
          {rows.slice(3).map((run, i) => (
            <ScoreRow key={run.author} rank={i + 4} run={run} me={run.author === me} onOpen={setViewing} />
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

function Podium({ top, me, onOpen }: { top: DailyRun[]; me: string; onOpen(pubkey: string): void }) {
  return (
    <ol className="grid grid-cols-3 items-end gap-2 pt-2" aria-label="Podium">
      {top.map((run, i) => (
        <li key={run.author} className={`row-start-1 ${PLACES[i].column}`}>
          <Step run={run} place={PLACES[i]} me={run.author === me} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  )
}

function Step({ run, place, me, onOpen }: { run: DailyRun; place: (typeof PLACES)[number]; me: boolean; onOpen(pubkey: string): void }) {
  const sprite = usePlayerSprite(run.author)
  const name = useDisplayName(run.author)
  return (
    <button
      onClick={() => onOpen(run.author)}
      aria-label={`${place.rank}. ${me ? 'You' : name}: ${run.score.toLocaleString()}`}
      className="flex w-full min-w-0 flex-col items-center gap-1"
    >
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 * (3 - place.rank), type: 'spring', stiffness: 300, damping: 18 }}>
        <SpriteView sprite={sprite} mood={place.rank === 1 ? 'win' : 'happy'} size={place.sprite} />
      </motion.div>
      <span className="w-full truncate text-center text-sm font-semibold">{me ? 'You' : name}</span>
      <span className="font-display text-lemon">{run.score.toLocaleString()}</span>
      <span className={`flex w-full items-start justify-center rounded-t-xl pt-1 text-2xl font-display ${place.height} ${place.block}`}>{place.rank}</span>
    </button>
  )
}

function ScoreRow({ rank, run, me, onOpen }: { rank: number; run: DailyRun; me: boolean; onOpen(pubkey: string): void }) {
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
        <span className="font-display text-lemon">{run.score.toLocaleString()}</span>
      </button>
    </li>
  )
}
