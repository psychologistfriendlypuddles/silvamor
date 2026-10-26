import { useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import confetti from 'canvas-confetti'
import { ArrowLeft, Eye, Flag, Link2, Pause, Play, Share2, SkipBack, SkipForward, Sparkles, StepBack, StepForward, Timer, UserPlus, X, Zap } from 'lucide-react'
import { useGame } from '../hooks/useGame'
import { useDisplayName } from '../hooks/useDisplayName'
import { parseGamePath } from '../lib/paths'
import { blocksToApproxTime } from '../lib/bitcoin'
import { inviteFragment, readInviteFragment } from '../lib/gameCrypto'
import { toast } from '../stores/toast'
import { copyText } from '../lib/clipboard'
import { Button, Card, Spinner } from '../components/ui'
import { PlayerCard, type Mood } from '../components/PlayerCard'
import { Avatar } from '../components/Avatar'
import { GAME_UI } from '../games/ui'
import { GameChat } from '../components/GameChat'
import { RulesButton } from '../components/RulesSheet'
import { useSpriteCue } from '../hooks/useSpriteCue'
import { SpriteView } from '../components/Sprite'
import { usePlayerSprite } from '../stores/sprites'
import { NoLightningAddress, WagerWarning } from '../components/Wager'
import { useZappable } from '../hooks/useZappable'
import { WagerPanel } from '../components/WagerPanel'
import { formatSats } from '../lib/wager'
import { useSigner } from '../stores/session'
import { FEATURES } from '../features'
import { PlayerSheet } from '../components/PlayerSheet'
import { THANKS_TIP, TipButton } from '../components/Tip'

export function GamePage() {
  const { naddr } = useParams()
  const address = useMemo(() => parseGamePath(naddr), [naddr])
  if (!address) return <Message emoji="🤷" title="That game link looks broken." />
  return <GameView address={address} />
}

function GameView({ address }: { address: NonNullable<ReturnType<typeof parseGamePath>> }) {
  const navigate = useNavigate()
  const game = useGame(address)
  const { listing, rules, result } = game
  const hostName = useDisplayName(address.host)
  // A link game's token arrives in the URL fragment (#invite=…), which never reaches a server.
  const [inviteToken] = useState(() => readInviteFragment(location.hash))
  const plainLink = `${location.origin}${location.pathname}`
  // Only the host hands out the invite; everyone else shares the plain (watch) link.
  const shareLink = game.hostToken ? plainLink + inviteFragment(game.hostToken) : plainLink

  if (!listing) {
    return game.notFound ? <Message emoji="🔍" title="Game not found on your relays." /> : <Message spinner title="Finding game…" />
  }
  if (!rules) return <Message emoji="🧩" title={`This client doesn't know "${listing.game}" yet.`} />

  const title = listing.title || `${hostName}'s ${rules.name}`

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => navigate('/')} className="rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Back to lobby">
          <ArrowLeft className="size-5" />
        </button>
        <span className="text-3xl">{rules.emoji}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-display">{title}</h1>
          <p className="flex items-center gap-1.5 text-sm text-white/50">
            {rules.name}
            {listing.options.size && ` · ${listing.options.size}×${listing.options.size}`}
            {listing.access === 'link' && <Link2 className="size-3.5" />}
            {listing.access === 'invite' && <UserPlus className="size-3.5" />}
            {FEATURES.wagers && listing.wager && (
              <span className="flex items-center gap-0.5 rounded-full bg-lemon/15 px-2 py-0.5 text-xs font-semibold text-lemon">
                <Zap className="size-3" /> {formatSats(listing.wager)}
              </span>
            )}
          </p>
        </div>
        <RulesButton listing={listing} />
        <ShareButton link={shareLink} />
      </div>

      {listing.status === 'cancelled' && !result?.started ? (
        <Message emoji="🫥" title="The host cancelled this game." />
      ) : !result?.started && listing.status !== 'open' ? (
        <Message spinner title="Loading moves…" />
      ) : !result?.started ? (
        <WaitingRoom game={game} inviteToken={inviteToken} shareLink={shareLink} />
      ) : (
        <Match game={game} />
      )}
    </div>
  )
}

type Game = ReturnType<typeof useGame>

function WaitingRoom({ game, inviteToken, shareLink }: { game: Game; inviteToken: string | null; shareLink: string }) {
  const { listing } = game
  const { pubkey } = useSigner()
  const [busy, setBusy] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const canReceive = useZappable(pubkey)

  if (!listing) return null

  const join = async (e: FormEvent) => {
    e.preventDefault()
    if (listing.wager && !agreed) return toast.error('Tick the box to agree to the wager first.')
    if (listing.wager && canReceive === false) return toast.error('To join a wager game, add a Lightning address that accepts zaps to your profile.')
    setBusy(true)
    try {
      await game.join(inviteToken)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  if (game.isHost) {
    return (
      <Card className="flex flex-col items-center gap-5 py-10 text-center">
        <HostSprite pubkey={listing.host} mood="idle" />
        <div>
          <h2 className="text-xl font-display">Waiting for an opponent…</h2>
          <p className="mt-1 max-w-sm text-sm text-white/55">
            {listing.access === 'invite'
              ? 'Your invited players will see this game in their lobby.'
              : listing.access === 'link'
                ? 'Send your invite link to one person. The first to open it gets the seat, and the link then stops working.'
                : 'Your game is in the lobby. Share the link to get a friend here faster.'}
          </p>
          <p className="mt-2 text-xs text-white/40">Keep the app open so you can let them in.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <CopyLinkButton link={shareLink} label={listing.access === 'link' ? 'Copy invite link' : 'Copy game link'} disabled={listing.access === 'link' && !game.hostToken} />
          <Button variant="danger" icon={<X className="size-5" />} onClick={() => game.cancel().catch(toast.error)}>
            Cancel game
          </Button>
        </div>
      </Card>
    )
  }

  if (game.hasJoined) {
    return (
      <Card className="flex flex-col items-center gap-5 py-10 text-center">
        <HostSprite pubkey={listing.host} mood="thinking" />
        <h2 className="text-xl font-display">Knock knock! 🚪</h2>
        <p className="max-w-sm text-sm text-white/55">You asked to join. The game starts as soon as the host lets you in.</p>
      </Card>
    )
  }

  if (!game.invited) {
    return <Message emoji="💌" title="This game is invite-only, and you're not on the list." />
  }

  if (listing.wager && !FEATURES.wagers) {
    return <Message emoji="🚫" title="This game was set up with a wager, which Silvamor doesn't offer. Pick another game in the lobby." />
  }

  if (listing.access === 'link' && !inviteToken) {
    return <Message emoji="🔗" title="This game needs its invite link. Ask the host to send it to you." />
  }

  return (
    <Card className="flex flex-col items-center gap-5 py-10 text-center">
      <HostSprite pubkey={listing.host} mood="happy" />
      <div>
        <h2 className="text-xl font-display">
          <HostName pubkey={listing.host} /> wants to play!
        </h2>
        <p className="mt-1 text-sm text-white/55">Take the empty seat.</p>
      </div>
      <form onSubmit={join} className={`flex w-full flex-col gap-3 ${listing.wager ? 'max-w-md text-left' : 'max-w-xs'}`}>
        {listing.wager && (
          <>
            <p className="flex items-center justify-center gap-1.5 text-center text-lg font-semibold text-lemon">
              <Zap className="size-5" /> This game has a {formatSats(listing.wager)} wager
            </p>
            <p className="text-center text-sm text-white/60">
              Whoever loses zaps the winner {formatSats(listing.wager)} (network fees not included). A draw pays nothing.
            </p>
            <WagerWarning sats={listing.wager} />
            {canReceive === false && <NoLightningAddress />}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white/5 p-3 text-sm">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-lemon" />
              <span>
                I agree to wager <b>{listing.wager.toLocaleString('en-US')} sats</b> on this game and to pay the winner if I lose, on the
                honor system described above. Wagering on games is legal where I live.
              </span>
            </label>
          </>
        )}
        <Button type="submit" variant="lemon" loading={busy} disabled={!!listing.wager && (!agreed || canReceive === false)} icon={<Sparkles className="size-5" />} className="py-4 text-lg">
          Join game
        </Button>
      </form>
    </Card>
  )
}

function Match({ game }: { game: Game }) {
  const { result, myIndex, listing } = game
  const ui = listing ? GAME_UI[listing.game] : undefined
  const [sending, setSending] = useState(false)
  const [confirmResign, setConfirmResign] = useState(false)
  const [profile, setProfile] = useState<string | null>(null)
  const celebrated = useRef(false)
  // Replay: index into result.steps being shown, or null for the live position.
  const [view, setView] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const lastStep = (result?.steps.length ?? 1) - 1
  const replaying = view !== null
  const outcome = replaying ? null : (result?.outcome ?? null)
  const shownState = replaying && result ? result.steps[view].state : result?.state
  const shownTurn = replaying ? game.rules!.turn(shownState) : (result?.turn ?? null)

  useEffect(() => {
    if (!playing || view === null) return
    const t = setTimeout(() => {
      if (view >= lastStep) {
        setPlaying(false)
        setView(null)
      } else setView(view + 1)
    }, REPLAY_STEP_MS)
    return () => clearTimeout(t)
  }, [playing, view, lastStep])

  const iWon = !!outcome && 'winner' in outcome && outcome.winner === myIndex
  useEffect(() => {
    if (!iWon || celebrated.current) return
    celebrated.current = true
    const burst = (x: number) => confetti({ particleCount: 90, spread: 70, origin: { x, y: 0.7 }, colors: ['#fde047', '#5eead4', '#ec4899', '#8b5cf6'] })
    burst(0.25)
    setTimeout(() => burst(0.75), 200)
  }, [iWon])

  if (!result || !listing || !ui) return null

  const moodFor = (i: number): Mood => {
    if (outcome) {
      if ('draw' in outcome) return 'draw'
      return outcome.winner === i ? 'win' : 'lose'
    }
    if (shownTurn === i) return 'thinking'
    // React to the last move: whoever just moved looks pleased.
    const shownLast = view ?? lastStep
    const last = result.steps[shownLast]?.action.event.pubkey
    return last === result.players[i] && shownLast > 0 ? 'happy' : 'idle'
  }

  const onMove = async (move: unknown) => {
    setSending(true)
    try {
      await game.move(move)
    } catch (err) {
      toast.error(err)
    } finally {
      setSending(false)
    }
  }

  const status = (() => {
    if (replaying) {
      if (view === 0) return 'Replay: the game begins…'
      const struck = result.steps[view].strikes.findIndex((s, i) => s > result.steps[view - 1].strikes[i])
      if (struck >= 0) {
        return (
          <>
            Replay: ⚡ strike {result.steps[view].strikes[struck]} for <HostName pubkey={result.players[struck]} /> ({view} of {lastStep})
          </>
        )
      }
      return `Replay: move ${view} of ${lastStep}`
    }
    if (outcome) {
      const note = ui.outcomeNote?.(shownState, outcome)
      if ('draw' in outcome) return note ? `It's a draw (${note})! 🤝` : "It's a draw! 🤝"
      const how = { resign: ' by resignation', strikes: ' (three strikes)', rules: note ? ` by ${note}` : '' }[outcome.reason ?? 'rules']
      if (myIndex >= 0) {
        if (outcome.winner === myIndex) {
          if (outcome.reason === 'resign') return 'Your opponent resigned. You win! 🏆'
          if (outcome.reason === 'strikes') return 'Three strikes for your opponent. You win! 🏆'
          return note ? `${note[0].toUpperCase()}${note.slice(1)}! You win! 🏆` : 'You win! 🏆'
        }
        if (outcome.reason === 'resign') return 'You resigned.'
        if (outcome.reason === 'strikes') return "Three strikes, you're out. ⚡"
        return note
          ? `${note[0].toUpperCase()}${note.slice(1)}. You lost this one. Better luck next time! 💪`
          : 'You lost this one. Better luck next time! 💪'
      }
      return <><HostName pubkey={result.players[outcome.winner]} /> wins{how}! 🏆</>
    }
    if (game.waitingForBlocks) return 'Waiting for the Bitcoin block height…'
    if (game.myTurn) return 'Your turn!'
    if (myIndex >= 0) return 'Waiting for your opponent…'
    return <><HostName pubkey={result.players[result.turn ?? 0]} /> is thinking…</>
  })()

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-3">
        {result.players.map((p, i) => (
          <MatchPlayer
            onOpen={() => setProfile(p)}
            key={p}
            game={game}
            index={i}
            shownState={shownState}
            shownStep={view ?? lastStep}
            pubkey={p}
            align={i === 0 ? 'left' : 'right'}
            mark={<ui.Badge player={i} state={shownState} />}
            active={!outcome && shownTurn === i}
            mood={moodFor(i)}
            label={p === game.listing?.host ? 'Host' : 'Challenger'}
            strikes={
              !listing.blocks
                ? null
                : replaying
                  ? (result.steps[view].strikes[i] ?? 0)
                  : (result.totalStrikes[i] ?? 0)
            }
          />
        ))}
      </div>

      {/* popLayout: the new status shows at once while the old one animates out. */}
      <AnimatePresence mode="popLayout">
        <motion.p
          key={replaying ? 'replay' : String(game.myTurn) + String(!!outcome)}
          initial={{ opacity: 0, y: -8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          className={`text-center text-xl font-bold ${game.myTurn && !replaying ? 'text-lemon' : ''}`}
        >
          {status}
        </motion.p>
      </AnimatePresence>
      {!replaying && result.nextStrikeAt !== null && (
        <BlockClock
          nextStrikeAt={result.nextStrikeAt}
          height={game.height}
          mine={game.myTurn}
          // Struck this turn: a strike is pending, or the last recorded action was a filed strike.
          struck={result.pendingStrikes > 0 || result.steps[result.steps.length - 1]?.action.content?.type === 'strike'}
          passes={!!game.rules?.onStrike}
        />
      )}

      {result.outcome && !replaying && <ThanksTips players={result.players} me={myIndex >= 0 ? result.players[myIndex] : null} />}
      {/* Tips only once the game is over: never before or during it. */}
      <PlayerSheet pubkey={profile} tipping={!!result.outcome} onClose={() => setProfile(null)} />

      {FEATURES.wagers && result.outcome && listing.wager && result.tip && (
        <WagerPanel
          listing={listing}
          players={result.players}
          winner={'draw' in result.outcome ? null : result.outcome.winner}
          endedAt={result.tip.createdAt}
        />
      )}

      <ui.Board
        state={shownState}
        outcome={outcome}
        me={myIndex}
        canMove={game.myTurn && !game.waitingForBlocks && !sending && !replaying}
        onMove={onMove}
      />

      {result.outcome && lastStep > 0 && (
        <ReplayControls
          view={view}
          last={lastStep}
          playing={playing}
          onView={(v) => {
            setPlaying(false)
            setView(v === null || v >= lastStep ? null : Math.max(0, v))
          }}
          onPlay={() => {
            if (playing) return setPlaying(false)
            if (view === null) setView(0)
            setPlaying(true)
          }}
        />
      )}

      {myIndex >= 0 && <GameChat messages={game.chat} me={result.players[myIndex]} onSend={game.sendChat} />}

      {result.forked && (
        <p className="text-center text-sm text-tangerine">⚠️ A player signed two different moves at the same point. This game is marked as forked.</p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {myIndex < 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm text-white/55">
            <Eye className="size-4" /> Spectating
          </span>
        )}
        {/* The real result, not the replay's: a finished game can't be resigned while replaying it. */}
        {myIndex >= 0 && !result.outcome && !replaying && (
          confirmResign ? (
            <>
              <span className="text-sm text-white/60">Really give up?</span>
              <Button variant="danger" onClick={() => game.resign().catch(toast.error)}>Yes, resign</Button>
              <Button variant="ghost" onClick={() => setConfirmResign(false)}>Keep playing</Button>
            </>
          ) : (
            <Button variant="ghost" icon={<Flag className="size-4" />} onClick={() => setConfirmResign(true)}>
              Resign
            </Button>
          )
        )}
      </div>
    </div>
  )
}

const REPLAY_STEP_MS = 1100

function ReplayControls({ view, last, playing, onView, onPlay }: { view: number | null; last: number; playing: boolean; onView(v: number | null): void; onPlay(): void }) {
  const current = view ?? last
  const btn = 'rounded-xl p-2.5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
      <div className="flex items-center justify-center gap-1 rounded-2xl bg-night-900/80 p-1.5">
        <button className={btn} onClick={() => onView(0)} disabled={current === 0} aria-label="First move"><SkipBack className="size-5" /></button>
        <button className={btn} onClick={() => onView(current - 1)} disabled={current === 0} aria-label="Previous move"><StepBack className="size-5" /></button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onPlay}
          className="mx-2 flex items-center gap-2 rounded-xl bg-gradient-to-r from-grape to-bubblegum px-4 py-2 font-semibold"
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          {playing ? 'Pause' : view === null ? 'Watch replay' : 'Play'}
        </motion.button>
        <button className={btn} onClick={() => onView(current + 1)} disabled={view === null} aria-label="Next move"><StepForward className="size-5" /></button>
        <button className={btn} onClick={() => onView(null)} disabled={view === null} aria-label="Final position"><SkipForward className="size-5" /></button>
      </div>
      <input
        type="range"
        min={0}
        max={last}
        value={current}
        onChange={(e) => onView(Number(e.target.value))}
        className="w-full accent-bubblegum"
        aria-label="Replay position"
      />
    </div>
  )
}

/** The turn clock in Bitcoin blocks: where the next strike lands and roughly when. */
function BlockClock({
  nextStrikeAt,
  height,
  mine,
  struck,
  passes,
}: {
  nextStrikeAt: number
  height: number | null
  mine: boolean
  struck: boolean
  /** Strikes pass the turn on in this game (rules.onStrike). */
  passes: boolean
}) {
  if (height === null) return null
  const left = Math.max(0, nextStrikeAt - height)
  const urgent = left <= 1
  return (
    <div className="-mt-3 flex flex-col items-center gap-0.5 text-center text-sm">
      {struck && (
        <motion.p initial={{ scale: 0.6 }} animate={{ scale: 1 }} className="font-semibold text-tangerine">
          ⚡{' '}
          {passes
            ? mine
              ? 'Out of time: strike, and the turn passed to you.'
              : 'Out of time: strike, and the turn passed to them.'
            : mine
              ? 'Strike! Still your turn.'
              : 'Strike! Still their turn.'}
        </motion.p>
      )}
      <motion.p
        animate={urgent ? { scale: [1, 1.06, 1] } : {}}
        transition={{ duration: 1.2, repeat: Infinity }}
        className={`flex items-center gap-1.5 font-semibold ${urgent ? 'text-bubblegum' : 'text-white/55'}`}
      >
        <Timer className="size-4" />
        {left === 0
          ? 'Strike block just mined, checking for a last-second move…'
          : `${mine ? 'Next strike' : 'Their next strike'} at block ${nextStrikeAt.toLocaleString()} · ${left} more block${left === 1 ? '' : 's'} (≈${blocksToApproxTime(left)})`}
      </motion.p>
      <p className="text-xs text-white/35">Bitcoin block {height.toLocaleString()}</p>
    </div>
  )
}

/**
 * After the game, for everyone: "Good game!" and a flat 21-sat thank-you tip for the opponent
 * (spectators can thank either player). The same whatever the result.
 */
function ThanksTips({ players, me }: { players: string[]; me: string | null }) {
  const [closed, setClosed] = useState(false)
  const others = players.filter((p) => p !== me)
  const opponent = useDisplayName(others[0])
  if (closed) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.6, type: 'spring', stiffness: 300, damping: 24 }}
      className="relative flex flex-col gap-3 rounded-3xl bg-gradient-to-br from-lemon/15 to-tangerine/10 p-4 ring-1 ring-lemon/30"
    >
      <button onClick={() => setClosed(true)} className="absolute top-2 right-2 rounded-xl p-1.5 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Dismiss">
        <X className="size-4" />
      </button>
      <p className="pr-8 font-semibold text-lemon">
        {me ? `Good game! Send ${opponent} a thank-you tip ⚡` : 'Good game! Send a player a thank-you tip ⚡'}
      </p>
      <div className="flex flex-wrap gap-2">
        {others.map((p) => (
          <TipButton key={p} pubkey={p} amount={THANKS_TIP} />
        ))}
      </div>
    </motion.div>
  )
}

/** A player card whose sprite also reacts to strikes, captures, checks and chat. */
function MatchPlayer({
  game,
  index,
  shownState,
  shownStep,
  ...card
}: { game: Game; index: number; shownState: unknown; shownStep: number } & ComponentProps<typeof PlayerCard>) {
  const ui = GAME_UI[game.listing!.game]
  const cue = useSpriteCue({
    strike: card.strikes ?? 0,
    capture: ui.captures?.(shownState, index) ?? 0,
    check: ui.inCheck?.(shownState, index) ? shownStep : 0,
    chat: game.chat.filter((m) => m.author === card.pubkey).length,
  })
  return <PlayerCard {...card} cue={cue} />
}

/** The host's sprite on a glowing pad, with their avatar, in the waiting room. */
function HostSprite({ pubkey, mood }: { pubkey: string; mood: Mood }) {
  const sprite = usePlayerSprite(pubkey)
  return (
    <div className="relative">
      <motion.span
        className="absolute inset-x-4 bottom-0 h-6 rounded-full bg-grape blur-md"
        animate={{ opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 1.6, repeat: Infinity }}
      />
      <SpriteView sprite={sprite} mood={mood} size={128} />
      <span className="absolute right-0 bottom-1 flex">
        <Avatar pubkey={pubkey} className="size-9 text-sm" />
      </span>
    </div>
  )
}

function HostName({ pubkey }: { pubkey: string }) {
  return <>{useDisplayName(pubkey)}</>
}

function CopyLinkButton({ link, label, disabled }: { link: string; label: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="secondary"
      disabled={disabled}
      icon={<Link2 className="size-5" />}
      onClick={async () => {
        await copyText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Link copied!' : label}
    </Button>
  )
}

function ShareButton({ link }: { link: string }) {
  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'Play me on Silvamor', url: link }).catch(() => {})
    } else {
      await copyText(link)
      toast.success('Game link copied')
    }
  }
  return (
    <button onClick={share} className="rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Share game">
      <Share2 className="size-5" />
    </button>
  )
}

function Message({ emoji, title, spinner }: { emoji?: string; title: ReactNode; spinner?: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-14 text-center">
      {spinner ? <Spinner /> : <span className="text-5xl">{emoji}</span>}
      <p className="font-medium text-white/70">{title}</p>
    </Card>
  )
}
