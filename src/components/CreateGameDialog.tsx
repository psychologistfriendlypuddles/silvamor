import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router'
import { Armchair, Globe, Link2, Timer, TriangleAlert, UserPlus, Users, UsersRound, X } from 'lucide-react'
import { GAMES, UPCOMING } from '../games/registry'
import { buildListing, newGameId, type GameAccess } from '../lib/nostr/gameEvents'
import { newInviteToken } from '../lib/gameCrypto'
import { publishTo } from '../lib/nostr/pool'
import { useSigner } from '../stores/session'
import { useLobby } from '../stores/lobby'
import { gameWriteRelays } from '../stores/relays'
import { toast } from '../stores/toast'
import { gamePath } from '../lib/paths'
import { Avatar } from './Avatar'
import { Button, Field } from './ui'
import { Modal } from './Modal'
import { FriendPicker } from './FriendPicker'
import { FEATURES } from '../features'
import { DEFAULT_SIZE as DOTS_DEFAULT_SIZE, SIZES as DOTS_SIZES } from '../games/dotsandboxes/rules'
import { DEFAULT_SIZE as GO_DEFAULT_SIZE, SIZES as GO_SIZES } from '../games/go/rules'
import { blocksToApproxTime } from '../lib/bitcoin'
import { useDisplayName } from '../hooks/useDisplayName'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { useGroups } from '../stores/groups'
import { WagerField } from './Wager'
import { RULES_TEXT } from '../games/rulesText'
import { zappable } from '../lib/wager'
import { useProfiles } from '../stores/profiles'

// "group" is a UI shortcut: the game is invite-only, with the group's members as the invitees.
type AccessMode = GameAccess | 'group'

const ACCESS: { value: AccessMode; label: string; icon: typeof Globe; hint: string }[] = [
  { value: 'open', label: 'Anyone', icon: Users, hint: 'First player to join gets the seat.' },
  { value: 'link', label: 'Invite link', icon: Link2, hint: 'You get a link to send to one person. The first to open it gets the seat; after that it stops working.' },
  { value: 'invite', label: 'Invite only', icon: UserPlus, hint: 'Only the people you pick can join.' },
  { value: 'group', label: 'Group', icon: UsersRound, hint: 'Only members of one of your groups can join.' },
]

// Turn clock in Bitcoin blocks (docs/PROTOCOL.md, "Turn clock").
const TURN_LIMITS = [
  { label: '1 block', blocks: 1 },
  { label: '3 blocks', blocks: 3 },
  { label: '6 blocks', blocks: 6 },
  { label: '144 blocks', blocks: 144 },
  { label: '432 blocks', blocks: 432 },
  { label: 'None', blocks: null },
]
const DEFAULT_TURN_LIMIT = 3

// Games with a choice of board size (the listing's `size` option).
const BOARD_SIZES: Record<string, { label: string; sizes: readonly number[]; default: number; bigFrom: number; bigHint: string }> = {
  dotsandboxes: {
    label: 'Board size (boxes)',
    sizes: DOTS_SIZES,
    default: DOTS_DEFAULT_SIZE,
    bigFrom: 12,
    bigHint: 'Big board: on a phone, pinch to zoom if the lines feel small.',
  },
  go: {
    label: 'Board size',
    sizes: GO_SIZES,
    default: GO_DEFAULT_SIZE,
    bigFrom: 13,
    bigHint: 'Bigger boards make longer games. On a phone, tap a point to preview, tap again to place.',
  },
}


export function CreateGameDialog({ open, onClose, initialGame = 'tictactoe' }: { open: boolean; onClose(): void; initialGame?: string }) {
  return (
    <Modal open={open} onClose={onClose}>
      <CreateGameForm onClose={onClose} initialGame={initialGame} />
    </Modal>
  )
}

function CreateGameForm({ onClose, initialGame }: { onClose(): void; initialGame: string }) {
  const { signer, pubkey } = useSigner()
  const navigate = useNavigate()
  const [game, setGame] = useState(GAMES[initialGame] ? initialGame : 'tictactoe')
  const [title, setTitle] = useState('')
  const [access, setAccess] = useState<AccessMode>('open')
  const [groupId, setGroupId] = useState<string | null>(null)
  const group = useGroups((s) => (groupId ? s.groups[groupId] : undefined))
  const [blocks, setBlocks] = useState<number | null>(DEFAULT_TURN_LIMIT)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const boardSize = BOARD_SIZES[game] ? (sizes[game] ?? BOARD_SIZES[game].default) : undefined
  const [invitees, setInvitees] = useState<string[]>([])
  const [wager, setWager] = useState<number | null>(null)
  const [wagerLegal, setWagerLegal] = useState(false)
  const [busy, setBusy] = useState(false)

  const addInvitee = (pk: string) => {
    if (pk === pubkey) return toast.error("You can't invite yourself.")
    setInvitees((list) => (list.includes(pk) ? list : [...list, pk]))
  }

  // Seats for challengers (the host takes one). More invitees than seats is fine, but say so.
  const seats = GAMES[game].players - 1
  const invitedCount =
    access === 'invite' ? invitees.length : access === 'group' ? (group?.members.filter((p) => p !== pubkey).length ?? 0) : 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (wager && !wagerLegal) return toast.error('Confirm that wagering is legal where you live, or turn the wager off.')
    if (access === 'invite' && invitees.length === 0) return toast.error('Invite at least one player.')
    if (access === 'group' && !group) return toast.error('Pick a group.')
    if (access === 'group' && group!.members.length === 0) return toast.error('That group has no members yet.')
    setBusy(true)
    try {
      if (wager && !(await zappable(useProfiles.getState().profiles[pubkey]?.content.lud16))) {
        throw new Error('To wager, add a Lightning address that accepts zaps to your profile.')
      }
      const id = newGameId()
      // Link games keep their token encrypted to the host, so any of the host's devices can share it.
      const invite = access === 'link' ? await signer.nip44Encrypt(pubkey, newInviteToken()) : undefined
      const event = await signer.signEvent(
        buildListing({
          id,
          game,
          status: 'open',
          access: access === 'group' ? 'invite' : access,
          blocks,
          options: boardSize ? { size: String(boardSize) } : undefined,
          pubkeys: access === 'invite' ? invitees : access === 'group' ? group!.members.filter((p) => p !== pubkey) : [],
          title: title.trim() || undefined,
          invite,
          wager,
        }),
      )
      const relays = gameWriteRelays()
      await publishTo(relays, event)
      useLobby.getState().add(event)
      onClose()
      navigate(gamePath(pubkey, id, relays))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display">New game ✨</h2>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white">
          <X className="size-5" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {Object.values(GAMES).map((g) => (
          <GameChoice key={g.id} emoji={g.emoji} name={g.name} selected={game === g.id} onClick={() => setGame(g.id)} />
        ))}
        {UPCOMING.map((g) => (
          <GameChoice key={g.name} emoji={g.emoji} name={g.name} disabled />
        ))}
      </div>

      {BOARD_SIZES[game] && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-white/70">{BOARD_SIZES[game].label}</span>
          <div className="flex flex-wrap gap-2">
            {BOARD_SIZES[game].sizes.map((size) => (
              <motion.button
                type="button"
                key={size}
                whileTap={{ scale: 0.93 }}
                onClick={() => setSizes({ ...sizes, [game]: size })}
                className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  boardSize === size ? 'border-lemon bg-lemon/10 text-white' : 'border-white/10 text-white/60 hover:border-white/25'
                }`}
              >
                {size}×{size}
              </motion.button>
            ))}
          </div>
          {boardSize! >= BOARD_SIZES[game].bigFrom && <p className="mt-1.5 text-xs text-white/45">{BOARD_SIZES[game].bigHint}</p>}
        </div>
      )}

      <Field label="Name (optional)" placeholder="Friday night showdown" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-white/70">Who can join?</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACCESS.map((a) => (
            <motion.button
              type="button"
              key={a.value}
              whileTap={{ scale: 0.95 }}
              onClick={() => setAccess(a.value)}
              className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 text-sm font-medium transition-colors ${
                access === a.value ? 'border-grape bg-grape/15 text-white' : 'border-white/10 text-white/60 hover:border-white/25'
              }`}
            >
              <a.icon className="size-5" />
              {a.label}
            </motion.button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-white/45">{ACCESS.find((a) => a.value === access)?.hint}</p>
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        {access === 'group' && (
          <motion.div key="grp" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <GroupChoice selected={groupId} onSelect={setGroupId} onManage={() => { onClose(); navigate('/groups') }} />
          </motion.div>
        )}
        {access === 'invite' && (
          <motion.div key="inv" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-2">
            <FriendPicker label="Invite players" selected={invitees} onAdd={addInvitee} collapsed />
            <div className="flex flex-wrap gap-2">
              {invitees.map((pk) => (
                <Invitee key={pk} pubkey={pk} onRemove={() => setInvitees((l) => l.filter((p) => p !== pk))} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {invitedCount > seats && (
        <p className="-mt-2 flex gap-2 rounded-2xl bg-tangerine/10 p-3 text-sm text-tangerine">
          <Armchair className="mt-0.5 size-4 shrink-0" />
          <span>
            {GAMES[game].name} has {seats === 1 ? 'one seat' : `${seats} seats`} for challengers, and you've invited {invitedCount}. The
            first {seats === 1 ? 'one' : seats} to join {seats === 1 ? 'plays' : 'play'}; everyone else invited can still watch.
          </span>
        </p>
      )}

      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white/70">
          <Timer className="size-4" /> Time per turn (Bitcoin blocks)
        </span>
        <div className="flex flex-wrap gap-2">
          {TURN_LIMITS.map((t) => (
            <motion.button
              type="button"
              key={t.label}
              whileTap={{ scale: 0.93 }}
              onClick={() => setBlocks(t.blocks)}
              className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-colors ${
                blocks === t.blocks ? 'border-lemon bg-lemon/10 text-white' : 'border-white/10 text-white/60 hover:border-white/25'
              }`}
            >
              {t.label}
            </motion.button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-white/45">
          {blocks
            ? `About ${blocksToApproxTime(blocks)} per turn. ${RULES_TEXT[game]?.timeout ?? ''} Three strikes and you lose.${
                FEATURES.ratings ? ' Strikes also count against your reliability rating.' : ''
              }`
            : 'No clock: a game can stall forever if someone walks away.'}
        </p>
        {blocks === 1 && (
          <p className="mt-2 flex gap-2 rounded-2xl bg-tangerine/10 p-3 text-sm text-tangerine">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Blocks arrive about every 10 minutes on average, but sometimes seconds apart or more than an hour apart. With 1
              block, your strike lands on the very next block, so you may get very little time. Each miss costs a strike, and
              three strikes lose the game.
            </span>
          </p>
        )}
      </div>

      {FEATURES.wagers && <WagerField pubkey={pubkey} value={wager} onChange={setWager} legal={wagerLegal} onLegal={setWagerLegal} />}

      <Button type="submit" loading={busy} className="py-4 text-lg">
        Create game
      </Button>
    </form>
  )
}

function GroupChoice({ selected, onSelect, onManage }: { selected: string | null; onSelect(id: string): void; onManage(): void }) {
  useLoadGroups()
  const { groups, loaded } = useGroups()
  const list = Object.values(groups).sort((a, b) => a.title.localeCompare(b.title))
  if (!loaded) return <p className="py-3 text-center text-sm text-white/50">Loading your groups…</p>
  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 p-4 text-center text-sm text-white/55">
        You don't have any groups yet.{' '}
        <button type="button" onClick={onManage} className="font-semibold text-mint hover:underline">
          Create one
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-white/70">Which group?</span>
      {list.map((g) => (
        <motion.button
          type="button"
          key={g.id}
          whileTap={{ scale: 0.97 }}
          onClick={() => onSelect(g.id)}
          className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-colors ${
            selected === g.id ? 'border-grape bg-grape/15' : 'border-white/10 hover:border-white/25'
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="font-display block truncate tracking-wide">{g.title}</span>
            <span className="text-xs text-white/50">
              {g.members.length} member{g.members.length === 1 ? '' : 's'}
            </span>
          </span>
          <span className="flex -space-x-2">
            {g.members.slice(0, 4).map((p) => (
              <Avatar key={p} pubkey={p} className="size-7 text-[10px]" />
            ))}
          </span>
        </motion.button>
      ))}
      <p className="text-xs text-white/40">Members are invited by npub, so the game shows up in their lobby.</p>
    </div>
  )
}

function GameChoice({ emoji, name, selected, disabled, onClick }: { emoji: string; name: string; selected?: boolean; disabled?: boolean; onClick?(): void }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -3 }}
      whileTap={disabled ? undefined : { scale: 0.93 }}
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1 rounded-2xl border-2 p-2 text-center text-[11px] leading-tight font-medium ${
        selected ? 'border-lemon bg-lemon/10' : 'border-white/10'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <span className="text-3xl">{emoji}</span>
      {name}
      {disabled && <span className="absolute -top-2 rounded-full bg-night-700 px-1.5 text-[9px] text-white/70">soon</span>}
    </motion.button>
  )
}

function Invitee({ pubkey, onRemove }: { pubkey: string; onRemove(): void }) {
  const name = useDisplayName(pubkey)
  return (
    <motion.span layout initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-2 rounded-full bg-night-700 py-1 pr-2 pl-1 text-sm">
      <Avatar pubkey={pubkey} className="size-6 text-xs" />
      <span className="max-w-32 truncate">{name}</span>
      <button type="button" onClick={onRemove} className="text-white/50 hover:text-white">
        <X className="size-3.5" />
      </button>
    </motion.span>
  )
}
