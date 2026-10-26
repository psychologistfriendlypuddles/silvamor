import { useEffect, useMemo, useState } from 'react'
import * as nip19 from 'nostr-tools/nip19'
import { Plus, Search, UserPlus } from 'lucide-react'
import { useGroups } from '../stores/groups'
import { useProfiles } from '../stores/profiles'
import { toast } from '../stores/toast'
import { displayName } from '../lib/nostr/profile'
import { resolvePubkey } from '../lib/nostr/resolve'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { Avatar } from './Avatar'
import { Button, Field } from './ui'

/** Search the people you follow, or paste anyone's npub / NIP-05. */
export function FriendPicker({
  selected,
  onAdd,
  label = 'Add friends',
  collapsed = false,
}: {
  selected: string[]
  onAdd(pubkey: string): void
  label?: string
  /** Keep the list closed until the search box is focused (for tight spaces like dialogs). */
  collapsed?: boolean
}) {
  useLoadGroups() // also loads who the user follows
  const follows = useGroups((s) => s.follows)
  const followsLoaded = useGroups((s) => s.loaded)
  const profiles = useProfiles((s) => s.profiles)
  const [query, setQuery] = useState('')
  const [resolving, setResolving] = useState(false)
  const [open, setOpen] = useState(!collapsed)

  useEffect(() => {
    useProfiles.getState().fetchMany(follows)
  }, [follows])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return follows
      .filter((pk) => !selected.includes(pk))
      .map((pk) => ({ pk, profile: profiles[pk]?.content }))
      // Match only the name shown in the list, never keys or NIP-05 addresses.
      .filter(({ profile }) => {
        if (!q) return true
        const shown = profile?.display_name || profile?.name
        return typeof shown === 'string' && shown.toLowerCase().includes(q)
      })
      .sort((a, b) => Number(!!b.profile) - Number(!!a.profile))
      .slice(0, 40)
  }, [follows, profiles, selected, query])

  const looksLikeId = /^(npub1|nprofile1|nostr:)|@|^[0-9a-f]{64}$/i.test(query.trim())

  const addTyped = async () => {
    setResolving(true)
    try {
      onAdd(await resolvePubkey(query))
      setQuery('')
    } catch (err) {
      toast.error(err)
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 p-3">
      <Field
        label={label}
        placeholder="Search people you follow, or paste an npub"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (looksLikeId) addTyped()
          else if (matches.length === 1) {
            onAdd(matches[0].pk)
            setQuery('')
          }
        }}
        trailing={<Search className="size-5 text-white/40" />}
      />
      {looksLikeId && (
        <Button
          type="button"
          variant="secondary"
          className="mt-2 w-full"
          loading={resolving}
          icon={<UserPlus className="size-4" />}
          onClick={addTyped}
        >
          Add this person
        </Button>
      )}
      {open && (
        <div className="mt-2 max-h-60 overflow-y-auto">
          {!followsLoaded ? (
            <p className="py-4 text-center text-sm text-white/40">Loading people you follow…</p>
          ) : follows.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/40">You don't follow anyone on Nostr yet. Paste an npub above instead.</p>
          ) : matches.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/40">No one matches.</p>
          ) : (
            matches.map(({ pk, profile }) => (
              <button
                type="button"
                key={pk}
                onClick={() => onAdd(pk)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5"
              >
                <Avatar pubkey={pk} className="size-8 text-xs" badge={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName(profile, nip19.npubEncode(pk))}</span>
                  {typeof profile?.nip05 === 'string' && <span className="block truncate text-xs text-white/40">{profile.nip05}</span>}
                </span>
                <Plus className="size-4 text-mint" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
