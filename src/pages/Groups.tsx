import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Trash2, Users, X } from 'lucide-react'
import { useSigner } from '../stores/session'
import { useGroups } from '../stores/groups'
import { toast } from '../stores/toast'
import type { Group } from '../lib/nostr/groups'
import { useDisplayName } from '../hooks/useDisplayName'
import { Avatar } from '../components/Avatar'
import { FriendPicker } from '../components/FriendPicker'
import { Modal } from '../components/Modal'
import { Button, Card, Field, PageTitle, Spinner } from '../components/ui'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { PlayerSheet } from '../components/PlayerSheet'

export function GroupsPage() {
  useLoadGroups()
  const { groups, loaded } = useGroups()
  const [editing, setEditing] = useState<Group | 'new' | null>(null)
  const list = Object.values(groups).sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle emoji="👥" title="Groups" subtitle="Your crews. Start a game for a group and only its members can join." />
        <Button icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>
          New group
        </Button>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <Users className="size-12 text-white/30" />
          </motion.div>
          <p className="font-medium text-white/70">No groups yet</p>
          <p className="max-w-xs text-sm text-white/45">Gather the friends you always play with, then start games just for them.</p>
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} className="mt-2">
            Create a group
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
                onClick={() => setEditing(g)}
                className="text-left"
              >
                <Card className="flex items-center gap-4 p-4 transition-colors hover:border-white/25">
                  <div className="min-w-0 flex-1">
                    <p className="font-display truncate text-lg tracking-wide">{g.title}</p>
                    <p className="mt-0.5 text-xs text-white/50">
                      {g.members.length} member{g.members.length === 1 ? '' : 's'}
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

      <Modal open={!!editing} onClose={() => setEditing(null)}>
        {editing && <GroupEditor group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  )
}

function GroupEditor({ group, onClose }: { group: Group | null; onClose(): void }) {
  const { signer, pubkey } = useSigner()
  const [title, setTitle] = useState(group?.title ?? '')
  const [members, setMembers] = useState<string[]>(group?.members ?? [])
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return toast.error('Give your group a name.')
    setBusy('save')
    try {
      await useGroups.getState().save(signer, { id: group?.id, title: title.trim(), members })
      toast.success(group ? 'Group saved' : `"${title.trim()}" created 🎉`)
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
      toast.success('Group deleted')
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl tracking-wide">{group ? 'Edit group' : 'New group ✨'}</h2>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white">
          <X className="size-5" />
        </button>
      </div>

      <Field label="Group name" placeholder="Friday night crew" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-white/70">Members ({members.length})</span>
        <div className="flex min-h-10 flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {members.map((pk) => (
              <MemberChip key={pk} pubkey={pk} onRemove={() => setMembers((m) => m.filter((p) => p !== pk))} />
            ))}
          </AnimatePresence>
          {members.length === 0 && <p className="text-sm text-white/40">Add friends below.</p>}
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
          {group ? 'Save' : 'Create group'}
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
