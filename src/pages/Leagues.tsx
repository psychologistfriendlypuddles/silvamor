import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Pencil, Plus, Trash2, Trophy, X } from 'lucide-react'
import { useSigner } from '../stores/session'
import { useGroups } from '../stores/groups'
import { toast } from '../stores/toast'
import type { Group } from '../lib/nostr/groups'
import { useDisplayName } from '../hooks/useDisplayName'
import { Avatar } from '../components/Avatar'
import { FriendPicker } from '../components/FriendPicker'
import { Modal } from '../components/Modal'
import { Button, Card, Field, PageTitle, Spinner, Switch } from '../components/ui'
import { RankedList, type Ranked } from '../components/DayGame'
import { feeTotals, lastDays, useBoardRuns, WINDOWS, type Window } from '../hooks/useBoardRuns'
import { sats } from '../games/miner/share'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { PlayerSheet } from '../components/PlayerSheet'

export function LeaguesPage() {
  useLoadGroups()
  const { groups, loaded } = useGroups()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const list = Object.values(groups).sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle emoji="🏆" title="Leagues" subtitle="Your own leaderboards. Pick the players in a league, then follow its standings day by day." />
        <Button icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>
          New league
        </Button>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <Trophy className="size-12 text-white/30" />
          </motion.div>
          <p className="font-medium text-white/70">No leagues yet</p>
          <p className="max-w-xs text-sm text-white/45">Pick the friends you want to compete with. Each league keeps its own standings.</p>
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} className="mt-2">
            Start a league
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <AnimatePresence initial={false}>
            {list.map((g) => (
              <motion.button
                key={g.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileHover={{ y: -3 }}
                onClick={() => navigate(`/leagues/${g.id}`)}
                className="text-left"
              >
                <Card className="flex items-center gap-4 p-4 transition-colors hover:border-white/25">
                  <div className="min-w-0 flex-1">
                    <p className="font-display truncate text-lg tracking-wide">{g.title}</p>
                    <p className="mt-0.5 text-xs text-white/50">
                      {g.members.length} player{g.members.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex -space-x-2.5">
                    {g.members.slice(0, 5).map((p) => (
                      <Avatar key={p} pubkey={p} className="size-9 text-xs" />
                    ))}
                  </div>
                </Card>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)}>
        {creating && <LeagueEditor group={null} onClose={() => setCreating(false)} />}
      </Modal>
    </div>
  )
}

/** One league: its players and standings. */
export function LeaguePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  useLoadGroups()
  const { groups, loaded } = useGroups()
  const [editing, setEditing] = useState(false)
  const league = groups[id]

  const back = (
    <Link to="/leagues" className="mb-4 inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-white">
      <ArrowLeft className="size-4" /> Leagues
    </Link>
  )
  if (!loaded) {
    return (
      <div className="flex justify-center py-14">
        <Spinner />
      </div>
    )
  }
  if (!league) {
    return (
      <div>
        {back}
        <Card className="py-12 text-center text-sm text-white/50">This league doesn't exist, or it was deleted.</Card>
      </div>
    )
  }
  return (
    <div>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle emoji="🏆" title={league.title} subtitle={`${league.members.length} player${league.members.length === 1 ? '' : 's'}, plus you`} />
        <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
          Edit league
        </Button>
      </div>
      <Standings league={league} />
      <Modal open={editing} onClose={() => setEditing(false)}>
        {editing && <LeagueEditor group={league} onClose={() => setEditing(false)} onDeleted={() => navigate('/leagues')} />}
      </Modal>
    </div>
  )
}

/** The league's players, you included, ranked by fees over a time window (as Top Scores is). */
function Standings({ league }: { league: Group }) {
  const { pubkey } = useSigner()
  const [span, setSpan] = useState<Window>('1')
  const days = useMemo(() => lastDays(Number(span)), [span])
  const players = useMemo(() => [...new Set([pubkey, ...league.members])], [pubkey, league.members])
  const runs = useBoardRuns(days, players)
  const rows = useMemo((): Ranked[] => feeTotals(runs ?? []).map((t) => ({ author: t.author, value: sats(t.fees), streak: t.streak })), [runs])
  // Today's scores are a target, so they stay hidden until you've played (as everywhere).
  const playedToday = (runs ?? []).some((r) => r.author === pubkey && r.day === days[0])

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wider text-white/50 uppercase">Standings</h2>
      <Switch<Window> options={[...WINDOWS]} value={span} onChange={setSpan} label="Time window" />
      <p className="text-xs text-white/45">
        {span === '1' ? 'The most fees in one block today.' : `Fees from each player's blocks over the last ${span} days, added up.`}
      </p>
      {runs === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : span === '1' && !playedToday ? (
        <p className="py-6 text-center text-sm text-white/50">Mine today's block to see today's standings.</p>
      ) : (
        <RankedList rows={rows} me={pubkey} empty="Nobody in this league has played yet." />
      )}
    </Card>
  )
}

function LeagueEditor({ group, onClose, onDeleted }: { group: Group | null; onClose(): void; onDeleted?(): void }) {
  const { signer, pubkey } = useSigner()
  const [title, setTitle] = useState(group?.title ?? '')
  const [members, setMembers] = useState<string[]>(group?.members ?? [])
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return toast.error('Give your league a name.')
    setBusy('save')
    try {
      await useGroups.getState().save(signer, { id: group?.id, title: title.trim(), members })
      toast.success(group ? 'League saved' : `"${title.trim()}" created 🎉`)
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!group) return
    setBusy('delete')
    try {
      await useGroups.getState().remove(signer, pubkey, group.id)
      toast.success('League deleted')
      onClose()
      onDeleted?.()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl tracking-wide">{group ? 'Edit league' : 'New league ✨'}</h2>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white">
          <X className="size-5" />
        </button>
      </div>

      <Field label="League name" placeholder="Friday night miners" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-white/70">Players ({members.length})</span>
        <div className="flex min-h-10 flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {members.map((pk) => (
              <MemberChip key={pk} pubkey={pk} onRemove={() => setMembers((m) => m.filter((p) => p !== pk))} />
            ))}
          </AnimatePresence>
          {members.length === 0 && <p className="text-sm text-white/40">Add players below.</p>}
        </div>
      </div>

      <FriendPicker selected={members} onAdd={(pk) => setMembers((m) => (m.includes(pk) || pk === pubkey ? m : [...m, pk]))} />

      <div className="flex items-center justify-between gap-2">
        {group ? (
          confirmDelete ? (
            <span className="flex items-center gap-2">
              <Button type="button" variant="danger" loading={busy === 'delete'} onClick={remove}>Delete</Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )
        ) : (
          <span />
        )}
        <Button type="submit" loading={busy === 'save'}>
          {group ? 'Save' : 'Create league'}
        </Button>
      </div>
    </form>
  )
}

function MemberChip({ pubkey, onRemove }: { pubkey: string; onRemove(): void }) {
  const name = useDisplayName(pubkey)
  const [open, setOpen] = useState(false)
  return (
    <motion.span layout initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex items-center gap-2 rounded-full bg-night-700 py-1 pr-2 pl-1 text-sm">
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2" aria-label={`${name}'s profile`}>
        <Avatar pubkey={pubkey} className="size-6 text-xs" />
        <span className="max-w-32 truncate">{name}</span>
      </button>
      <PlayerSheet pubkey={open ? pubkey : null} onClose={() => setOpen(false)} />
      <button type="button" onClick={onRemove} className="text-white/50 hover:text-white" aria-label={`Remove ${name}`}>
        <X className="size-3.5" />
      </button>
    </motion.span>
  )
}
