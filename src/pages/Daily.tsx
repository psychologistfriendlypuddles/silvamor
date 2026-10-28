import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { RotateCw } from 'lucide-react'
import { Button, Card, PageTitle, Spinner } from '../components/ui'
import { SpriteView } from '../components/Sprite'
import { DayBlock, Leaderboard, NextDay, SharePrompt } from '../components/DayGame'
import { usePlayerSprite } from '../stores/sprites'
import type { Sprite } from '../lib/sprites'
import { toast } from '../stores/toast'
import { useSigner } from '../stores/session'
import { useGroups } from '../stores/groups'
import { gameWriteRelays } from '../stores/relays'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { useDailyRuns } from '../hooks/useDailyRuns'
import { publishTo } from '../lib/nostr/pool'
import { buildRun, confirmedStreak, nextStreak, type DailyRun } from '../lib/nostr/dailyRuns'
import { useStreaks } from '../hooks/useStreaks'
import type { Block } from '../lib/bitcoin'
import { markShareOffered, shareOffered } from '../lib/shareOffer'
import { DailyDealBoard, ScoreLine } from '../games/dailydeal/Board'
import { dailyDealRules, type DailyDealMove, type DailyDealState } from '../games/dailydeal/rules'
import { shareText } from '../games/dailydeal/share'
import { dayOf, loadMoves, saveMoves, seedFor } from '../games/dailydeal/daily'

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
  return (
    <div>
      <PageTitle emoji="🃏" title="Daily Deal" subtitle={`Everyone gets the same cards and perks today (${day}). Make your hands count.`} />
      <DayBlock day={day} seeds="Today's deck is shuffled">
        {/* Keyed by account, so switching logins starts that account's own run. */}
        {(block) => <Run key={pubkey} day={day} block={block} />}
      </DayBlock>
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
  const yesterday = useStreaks(day, everyone)
  const streakOf = (run: DailyRun) => confirmedStreak(run, yesterday.streaks.get(run.author))
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
      const streak = nextStreak(yesterday.streaks.get(pubkey))
      const event = await signer.signEvent(buildRun({ day, block, moves, score: state.score, streak, beaten }))
      await publishTo(gameWriteRelays(), event)
      add(event)
      setPublishing('idle')
      if (!shareOffered('dailydeal', pubkey, day)) setSharing(true)
    } catch (err) {
      setPublishing('failed')
      toast.error(err)
    }
  }
  useEffect(() => {
    if (!finished || !followsLoaded || !loaded || !yesterday.loaded || mine || started.current) return
    started.current = true
    publish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, followsLoaded, loaded, yesterday.loaded, mine])

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
  const myStreak = mine ? streakOf(mine) : nextStreak(yesterday.streaks.get(pubkey))
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
      <Summary states={shown} sprite={sprite} streak={myStreak} />
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
      <Leaderboard runs={runs} me={pubkey} follows={follows} groups={Object.values(groups)} streakOf={streakOf} />
      <SharePrompt
        open={sharing}
        text={() => shareText(day, shown[shown.length - 1].score, myStreak, shown.flatMap((s) => (s.last && 'play' in s.last ? [s.last.play] : [])), location.origin)}
        onClose={() => {
          markShareOffered('dailydeal', pubkey, day)
          setSharing(false)
        }}
      />
    </div>
  )
}

function Summary({ states, sprite, streak }: { states: DailyDealState[]; sprite: Sprite; streak: number }) {
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
      {streak > 1 && <p className="-mt-2 font-semibold text-tangerine">🔥 {streak}-day streak</p>}
      <ol className="flex w-full flex-col gap-1.5" aria-label="Hands played">
        {plays.map((play, i) => (
          <li key={i} className="rounded-2xl bg-night-950/60 px-4 py-2">
            <ScoreLine play={play} />
          </li>
        ))}
      </ol>
      <NextDay what="deal" />
    </Card>
  )
}
