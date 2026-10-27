import { create } from 'zustand'
import { DISCOVERY_RELAYS, pool, publishTo } from '../lib/nostr/pool'
import { FOLLOW_SET_KIND, buildGroup, buildGroupDeletion, parseGroup, type Group } from '../lib/nostr/groups'
import { bytesToHex } from 'nostr-tools/utils'
import type { AppSigner } from '../lib/nostr/signers'
import { gameReadRelays, gameWriteRelays } from './relays'

interface GroupsState {
  groups: Record<string, Group>
  /** People the user follows (kind 3), the pool friends are picked from. */
  follows: string[]
  loaded: boolean
  loading: boolean
  load(signer: AppSigner, pubkey: string): Promise<void>
  save(signer: AppSigner, group: Omit<Group, 'createdAt' | 'id'> & { id?: string }): Promise<Group>
  remove(signer: AppSigner, pubkey: string, id: string): Promise<void>
}

const relaysFor = () => [...new Set([...gameReadRelays(), ...DISCOVERY_RELAYS])]

export const useGroups = create<GroupsState>((set, get) => ({
  groups: {},
  follows: [],
  loaded: false,
  loading: false,

  async load(signer, pubkey) {
    if (get().loading) return
    set({ loading: true })
    try {
      const [sets, contacts] = await Promise.all([
        pool.querySync(relaysFor(), { kinds: [FOLLOW_SET_KIND], authors: [pubkey] }, { maxWait: 5000 }),
        pool.get(relaysFor(), { kinds: [3], authors: [pubkey] }, { maxWait: 5000 }),
      ])

      // Keep the newest version of each set.
      const newest = new Map<string, (typeof sets)[number]>()
      for (const e of sets) {
        const d = e.tags.find((t) => t[0] === 'd')?.[1]
        if (d !== undefined && (!newest.has(d) || newest.get(d)!.created_at < e.created_at)) newest.set(d, e)
      }
      const decrypt = (text: string) => signer.nip44Decrypt(pubkey, text)
      const parsed = await Promise.all([...newest.values()].map((e) => parseGroup(e, decrypt)))
      const groups = Object.fromEntries(parsed.filter((g): g is Group => !!g).map((g) => [g.id, g]))

      const follows = (contacts?.tags ?? []).filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? '')).map((t) => t[1])
      set({ groups, follows: [...new Set(follows)], loaded: true })
    } finally {
      set({ loading: false })
    }
  },

  async save(signer, input) {
    const group = { ...input, id: input.id ?? bytesToHex(crypto.getRandomValues(new Uint8Array(8))) }
    const event = await signer.signEvent(buildGroup(group))
    await publishTo(gameWriteRelays(), event)
    const saved = { ...group, createdAt: event.created_at }
    set({ groups: { ...get().groups, [saved.id]: saved } })
    return saved
  },

  async remove(signer, pubkey, id) {
    const { deletion, tombstone } = buildGroupDeletion(pubkey, id)
    const relays = gameWriteRelays()
    await publishTo(relays, await signer.signEvent(tombstone))
    await publishTo(relays, await signer.signEvent(deletion)).catch(() => {})
    const groups = { ...get().groups }
    delete groups[id]
    set({ groups })
  },
}))
