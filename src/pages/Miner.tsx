import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { Event } from 'nostr-tools/pure'
import { ExternalLink, RotateCw } from 'lucide-react'
import { Button, Card, PageTitle, Spinner } from '../components/ui'
import { SpriteView } from '../components/Sprite'
import { DayBlock, NextDay, SharePrompt } from '../components/DayGame'
import { usePlayerSprite } from '../stores/sprites'
import type { Sprite } from '../lib/sprites'
import { toast } from '../stores/toast'
import { useSigner } from '../stores/session'
import { useGroups } from '../stores/groups'
import { gameWriteRelays } from '../stores/relays'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { useGameRuns } from '../hooks/useGameRuns'
import { HOME_RELAY, pool, publishTo } from '../lib/nostr/pool'
import { MINER_RUN_KIND, buildMinerRun, confirmedStreak, countedMinerRuns, nextStreak, parseMinerRun, type MinerRun } from '../lib/nostr/minerRuns'
import { useStreaks } from '../hooks/useStreaks'
import type { Block } from '../lib/bitcoin'
import { markShareOffered, shareOffered } from '../lib/shareOffer'
import { dayOf } from '../games/day'
import { MinerBoard } from '../games/miner/Board'
import { GameInfo } from '../games/miner/GameInfo'
import { dealFor, loadDeal, loadMoves, saveMoves } from '../games/miner/local'
import { bestFees, decodeMoves, encodeMoves, minerFees, minerRules, minerSeed, type MinerDeal, type MinerMove, type MinerState } from '../games/miner/rules'
import { GAME_TAG, sats, shareText } from '../games/miner/share'

export function MinerPage() {
  const { pubkey } = useSigner()
  const [day] = useState(() => dayOf(new Date()))
  return (
    <div>
      <PageTitle
        emoji="⛏️"
        title="Block of the Day"
        subtitle="Real transactions from today's first Bitcoin block arrive one by one. Take them or pass, and fill your block with more fees than the NPC miner. Just remember: the block could be found any moment!"
      />
      <DayBlock day={day} seeds="Today's transactions are picked">
        {/* Keyed by account, so switching logins starts that account's own run. */}
        {(block) => (
          <>
            <GameInfo day={day} block={block} />
            <DealLoader key={pubkey} day={day} block={block} />
          </>
        )}
      </DayBlock>
    </div>
  )
}

/** Reads the day's deal from its block (once per browser), then plays it. */
function DealLoader({ day, block }: { day: string; block: Block }) {
  const [deal, setDeal] = useState<MinerDeal | null>(() => loadDeal(block.hash))
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (deal) return
    let cancelled = false
    dealFor(day, block).then(
      (d) => !cancelled && setDeal(d),
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
    }
  }, [day, block, deal, attempt])

  if (deal) return <Run day={day} block={block} deal={deal} />
  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center gap-3 py-10 text-center">
      {failed ? (
        <>
          <p className="font-medium text-white/80">Couldn't read today's transactions from the block sources.</p>
          <Button
            variant="secondary"
            icon={<RotateCw className="size-4" />}
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <>
          <Spinner />
          <p className="font-medium text-white/80">Gathering today's transactions…</p>
        </>
      )}
    </Card>
  )
}

/** Replays saved moves, keeping the ones that still apply (a bad save just ends early). */
function restore(deal: MinerDeal, saved: string): MinerMove[] {
  const rules = minerRules(deal)
  const moves: MinerMove[] = []
  let state = rules.init()
  for (const raw of decodeMoves(saved)) {
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

const play = (deal: MinerDeal, moves: unknown[]) => {
  const rules = minerRules(deal)
  return moves.reduce<MinerState>((s, m) => rules.apply(s, rules.parseMove(m)), rules.init())
}

/**
 * Publishes a run to Silvamor's relay, which has to take it (boards and streaks read that relay
 * alone), and only then to the player's own relays: a copy only there would look published when it
 * isn't, and a reload wouldn't try again.
 */
async function publishRun(event: Event) {
  try {
    await pool.publish([HOME_RELAY], event, { maxWait: 10_000 })[0]
  } catch (err) {
    const reason = String(err instanceof Error ? err.message : err).replace(/^blocked: /, '')
    throw new Error(`${HOME_RELAY.replace(/^wss?:\/\//, '')} didn't take your block: ${reason}`, { cause: err })
  }
  void publishTo(gameWriteRelays().filter((r) => r !== HOME_RELAY), event).catch(() => {})
}

function Run({ day, block, deal }: { day: string; block: Block; deal: MinerDeal }) {
  const { signer, pubkey } = useSigner()
  useLoadGroups()
  const follows = useGroups((s) => s.follows)
  const groups = useGroups((s) => s.groups)
  const followsLoaded = useGroups((s) => s.loaded)
  const everyone = useMemo(() => [pubkey, ...follows, ...Object.values(groups).flatMap((g) => g.members)], [pubkey, follows, groups])
  const count = useCallback(
    (events: Event[]) => countedMinerRuns(events.map(parseMinerRun).filter((r): r is MinerRun => r !== null && r.day === day), block, deal),
    [day, block, deal],
  )
  const { runs, loaded, add } = useGameRuns(MINER_RUN_KIND, day, everyone, count)
  const mine: MinerRun | undefined = runs.get(pubkey)
  const yesterday = useStreaks(day, everyone)
  const streakOf = (run: MinerRun) => confirmedStreak(run, yesterday.streaks.get(run.author))
  const sprite = usePlayerSprite(pubkey)

  const seed = useMemo(() => minerSeed(day, block.hash), [day, block])
  const [moves, setMoves] = useState(() => restore(deal, loadMoves(pubkey, seed)))
  const state = useMemo(() => play(deal, moves), [deal, moves])
  const finished = state.found

  // Publish the run once it's over: only the first one counts, so never twice.
  const [publishing, setPublishing] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [sharing, setSharing] = useState(false)
  const started = useRef(false)
  const publish = async () => {
    setPublishing('busy')
    try {
      const streak = nextStreak(yesterday.streaks.get(pubkey))
      const event = await signer.signEvent(buildMinerRun({ day, block, moves, score: state.fees, streak }))
      await publishRun(event)
      add(event)
      setPublishing('idle')
      if (!shareOffered('miner', pubkey, day)) setSharing(true)
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

  const onMove = (move: MinerMove) => {
    try {
      minerRules(deal).apply(state, move)
    } catch (err) {
      toast.error(err)
      return
    }
    const next = [...moves, move]
    setMoves(next)
    saveMoves(pubkey, seed, encodeMoves(next))
  }

  // A published run (maybe from another device) is the one that counts.
  const shown = mine ? play(deal, decodeMoves(mine.moves)) : finished ? state : null
  const others = [...runs.keys()].filter((p) => p !== pubkey).length

  if (!shown) {
    return (
      <div className="flex flex-col gap-4">
        <MinerBoard deal={deal} state={state} sprite={sprite} onMove={onMove} />
        {others > 0 && (
          <p className="text-center text-sm text-white/50">
            {others === 1 ? '1 friend has' : `${others} friends have`} played today. Finish your block to see today's scores.
          </p>
        )}
      </div>
    )
  }
  const myStreak = mine ? streakOf(mine) : nextStreak(yesterday.streaks.get(pubkey))
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Summary deal={deal} state={shown} block={block} sprite={sprite} streak={myStreak} />
      {!mine && (
        <p className="flex items-center justify-center gap-2 text-sm text-white/60">
          {publishing === 'failed' ? (
            <Button variant="secondary" icon={<RotateCw className="size-4" />} onClick={publish}>
              Publish my block
            </Button>
          ) : (
            <>
              <Spinner className="size-4" /> Publishing your block…
            </>
          )}
        </p>
      )}
      <SharePrompt
        open={sharing}
        hashtag={GAME_TAG}
        text={() => shareText(day, block.height, shown.fees, minerFees(deal), myStreak, location.origin)}
        onClose={() => {
          markShareOffered('miner', pubkey, day)
          setSharing(false)
        }}
      />
    </div>
  )
}

function Summary({ deal, state, block, sprite, streak }: { deal: MinerDeal; state: MinerState; block: Block; sprite: Sprite; streak: number }) {
  const miner = minerFees(deal)
  const best = bestFees(deal)
  const won = state.fees > miner
  return (
    <Card initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 text-center">
      <SpriteView sprite={sprite} mood={won ? 'win' : 'sad'} size={96} />
      <p className="text-sm font-semibold tracking-wider text-white/50 uppercase">Block found after {deal.foundAt} transactions</p>
      <motion.p
        initial={{ scale: 0.5 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="text-5xl font-display text-lemon"
        aria-label="Your fees"
      >
        {sats(state.fees)}
      </motion.p>
      {streak > 1 && <p className="-mt-2 font-semibold text-tangerine">🔥 {streak}-day streak</p>}
      <p className={`font-semibold ${won ? 'text-mint' : 'text-tangerine'}`}>
        {won
          ? `You beat the miner by ${sats(state.fees - miner)}!`
          : state.fees === miner
            ? 'A tie with the miner!'
            : `The miner wins today by ${sats(miner - state.fees)}.`}{' '}
        The miner's block: {sats(miner)}
      </p>
      <dl className="grid w-full grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-night-950/60 px-3 py-2">
          <dt className="text-white/50">Best block possible</dt>
          <dd className="font-semibold">
            {sats(best)} <span className="text-white/50">({state.fees >= best ? 'you got it!' : `you: ${sats(best - state.fees)} short`})</span>
          </dd>
        </div>
        <div className="rounded-2xl bg-night-950/60 px-3 py-2">
          <dt className="text-white/50">Your block</dt>
          <dd className="font-semibold">
            {state.taken.length} transactions, {Math.round((state.used / deal.capacity) * 100)}% full
          </dd>
        </div>
      </dl>
      <a href={`https://mempool.space/block/${block.hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-sky hover:underline">
        See the real block {block.height.toLocaleString('en-US')} <ExternalLink className="size-3.5" />
      </a>
      <NextDay what="block" />
    </Card>
  )
}
