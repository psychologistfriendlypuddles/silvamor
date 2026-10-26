import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Eye, Link2, Plus, Swords, UserPlus, Users, Zap } from 'lucide-react'
import { formatSats } from '../lib/wager'
import { useSession } from '../stores/session'
import { useLobby } from '../stores/lobby'
import { GAMES, UPCOMING, rulesFor } from '../games/registry'
import type { GameListing } from '../lib/nostr/gameEvents'
import { gamePath } from '../lib/paths'
import { timeAgo, useDisplayName } from '../hooks/useDisplayName'
import { toast } from '../stores/toast'
import { Button, Card, Spinner } from '../components/ui'
import { Avatar } from '../components/Avatar'
import { CreateGameDialog } from '../components/CreateGameDialog'
import { FEATURES } from '../features'

const GRADIENTS: Record<string, string> = {
  tictactoe: 'from-lemon/30 to-tangerine/10 hover:ring-lemon/60',
  fourinarow: 'from-bubblegum/30 to-grape/10 hover:ring-bubblegum/60',
  dotsandboxes: 'from-sky/30 to-grape/10 hover:ring-sky/60',
  chess: 'from-mint/30 to-sky/10 hover:ring-mint/60',
  reversi: 'from-mint/30 to-grape/10 hover:ring-mint/60',
  checkers: 'from-tangerine/30 to-bubblegum/10 hover:ring-tangerine/60',
  go: 'from-grape/30 to-sky/10 hover:ring-grape/60',
  gomoku: 'from-sky/30 to-mint/10 hover:ring-sky/60',
  morris: 'from-lemon/30 to-mint/10 hover:ring-lemon/60',
}
const UPCOMING_GRADIENTS = ['from-mint/30 to-sky/10']

type Tab = 'open' | 'live' | 'mine'

export function LobbyPage() {
  const pubkey = useSession((s) => s.pubkey)!
  const { listings, loaded } = useLobby()
  const [tab, setTab] = useState<Tab>('open')
  const [creating, setCreating] = useState<string | null>(null)
  const [dayAgo] = useState(() => Date.now() / 1000 - 24 * 3600)

  const groups = useMemo(() => {
    // While wagers are off, other clients' wager games aren't listed.
    const all = Object.values(listings).filter((l) => rulesFor(l.game, l.options) && (FEATURES.wagers || !l.wager))
    const mine = (l: GameListing) => l.host === pubkey || l.pubkeys.includes(pubkey)
    const byNewest = (a: GameListing, b: GameListing) => b.createdAt - a.createdAt
    return {
      open: all.filter((l) => l.status === 'open' && l.host !== pubkey).sort(byNewest),
      live: all.filter((l) => l.status === 'active' && l.createdAt > dayAgo).sort(byNewest),
      mine: all.filter((l) => mine(l) && l.status !== 'cancelled').sort(byNewest),
    }
  }, [listings, pubkey, dayAgo])

  const shown = groups[tab]

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display tracking-tight md:text-4xl">Game Lobby</h1>
        </div>
        <Button icon={<Plus className="size-5" />} onClick={() => setCreating('tictactoe')}>
          Create game
        </Button>
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wider text-white/50 uppercase">Start a game</h2>
      <div className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.values(GAMES).map((g, i) => (
          <GameTile key={g.id} index={i} emoji={g.emoji} name={g.name} gradient={GRADIENTS[g.id]} onClick={() => setCreating(g.id)} />
        ))}
        {UPCOMING.map((g, i) => (
          <GameTile
            key={g.name}
            index={i + 1}
            emoji={g.emoji}
            name={g.name}
            gradient={UPCOMING_GRADIENTS[i]}
            soon
            onClick={() => toast.info(`${g.name} is coming in the next phase!`)}
          />
        ))}
      </div>

      <div className="mb-3 flex gap-1 rounded-2xl bg-night-900/70 p-1">
        {(
          [
            ['open', 'Open', groups.open.length],
            ['live', 'Live', groups.live.length],
            ['mine', 'My games', groups.mine.length],
          ] as const
        ).map(([value, label, count]) => (
          <button key={value} onClick={() => setTab(value)} className="relative flex-1 rounded-xl py-2.5 text-sm font-semibold">
            {tab === value && <motion.span layoutId="lobby-tab" className="absolute inset-0 rounded-xl bg-white/10" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
            <span className={`relative ${tab === value ? 'text-white' : 'text-white/50'}`}>
              {label} {count > 0 && <span className="ml-1 rounded-full bg-bubblegum px-1.5 text-xs text-white">{count}</span>}
            </span>
          </button>
        ))}
      </div>

      {!loaded && shown.length === 0 ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState tab={tab} onCreate={() => setCreating('tictactoe')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <AnimatePresence initial={false}>
            {shown.map((l) => (
              <GameCard key={l.coordinate} listing={l} me={pubkey} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <CreateGameDialog open={!!creating} initialGame={creating ?? undefined} onClose={() => setCreating(null)} />
    </div>
  )
}

function GameTile({ index, emoji, name, gradient, soon, onClick }: { index: number; emoji: string; name: string; gradient: string; soon?: boolean; onClick(): void }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
      whileHover={{ y: -6, rotate: index % 2 ? 1.5 : -1.5 }}
      whileTap={{ scale: 0.95 }}
      className={`group relative flex flex-col items-center gap-2 rounded-3xl bg-gradient-to-br p-5 ring-2 ring-white/10 ${gradient} ${soon ? 'opacity-60' : ''}`}
    >
      {soon && <span className="absolute top-2 right-2 rounded-full bg-night-950/60 px-2 py-0.5 text-[10px] font-semibold text-white/70">SOON</span>}
      <span className="text-5xl group-hover:animate-wiggle">{emoji}</span>
      <span className="font-semibold">{name}</span>
      <span className="text-xs text-white/50">{soon ? 'Coming soon' : 'Tap to play'}</span>
    </motion.button>
  )
}

function GameCard({ listing, me }: { listing: GameListing; me: string }) {
  const rules = rulesFor(listing.game, listing.options)!
  const hostName = useDisplayName(listing.host)
  const players = listing.status === 'open' ? [listing.host] : listing.pubkeys
  const invitedMe = listing.access === 'invite' && listing.pubkeys.includes(me) && listing.status === 'open'

  const badge = {
    open: listing.host === me ? 'Waiting' : invitedMe ? "You're invited!" : 'Open seat',
    active: listing.pubkeys.includes(me) ? 'Playing' : 'Live',
    finished: 'Finished',
    cancelled: 'Cancelled',
  }[listing.status]
  const badgeColor = {
    open: invitedMe ? 'bg-bubblegum text-white' : 'bg-mint/20 text-mint',
    active: 'bg-lemon/20 text-lemon',
    finished: 'bg-white/10 text-white/60',
    cancelled: 'bg-white/10 text-white/40',
  }[listing.status]

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
      <Link to={gamePath(listing.host, listing.id)}>
        <Card whileHover={{ y: -3 }} className="flex items-center gap-4 p-4 transition-colors hover:border-white/25">
          <span className="text-4xl">{rules.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{listing.title || `${hostName}'s ${rules.name}`}</p>
            <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
              <div className="flex -space-x-2">
                {players.slice(0, 2).map((p) => (
                  <Avatar key={p} pubkey={p} className="size-6 text-[10px]" />
                ))}
              </div>
              <span>{timeAgo(listing.createdAt)}</span>
              {listing.options.size && (
                <span>
                  · {listing.options.size}×{listing.options.size}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <AccessChip access={listing.access} invitedMe={listing.access === 'invite' && listing.pubkeys.includes(me)} />
              {listing.wager && (
                <span className="mt-1.5 inline-flex items-center gap-0.5 rounded-full bg-lemon/15 px-2 py-0.5 text-[11px] font-semibold text-lemon" title="Friendly wager (honor system)">
                  <Zap className="size-3" />
                  {formatSats(listing.wager)}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeColor}`}>{badge}</span>
            {listing.status === 'active' && !listing.pubkeys.includes(me) && <Eye className="size-4 text-white/40" />}
          </div>
        </Card>
      </Link>
    </motion.div>
  )
}

const ACCESS_STYLES = {
  open: { icon: Users, label: 'Anyone can join', className: 'bg-mint/15 text-mint' },
  link: { icon: Link2, label: 'Invite link', className: 'bg-lemon/15 text-lemon' },
  invite: { icon: UserPlus, label: 'Invite only', className: 'bg-bubblegum/15 text-bubblegum' },
}

function AccessChip({ access, invitedMe }: { access: GameListing['access']; invitedMe: boolean }) {
  const { icon: Icon, label, className } = ACCESS_STYLES[access]
  return (
    <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>
      <Icon className="size-3" />
      {label}
      {invitedMe && ' · you’re on the list'}
    </span>
  )
}

function EmptyState({ tab, onCreate }: { tab: Tab; onCreate(): void }) {
  const text = {
    open: ['No open games right now', 'Be the first! Create a game and others will see it here, live.'],
    live: ['Nobody is playing right now', 'Public games in progress show up here so you can watch.'],
    mine: ["You haven't played yet", 'Games you host, join or get invited to will be listed here.'],
  }[tab]
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <motion.div animate={{ rotate: [0, -10, 10, 0] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}>
        <Swords className="size-12 text-white/30" />
      </motion.div>
      <p className="font-medium text-white/70">{text[0]}</p>
      <p className="max-w-xs text-sm text-white/45">{text[1]}</p>
      {tab !== 'live' && (
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={onCreate} className="mt-2">
          Create a game
        </Button>
      )}
    </Card>
  )
}
