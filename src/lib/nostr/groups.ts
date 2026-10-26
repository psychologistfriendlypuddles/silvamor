import type { Event, EventTemplate } from 'nostr-tools/pure'

// Groups are NIP-51 follow sets: named, addressable lists of people that
// other Nostr apps understand too.
export const FOLLOW_SET_KIND = 30000
export const DELETION_KIND = 5

export interface Group {
  id: string
  title: string
  members: string[]
  createdAt: number
}

type Crypt = (text: string) => Promise<string>

const isPubkey = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

/**
 * Reads a follow set. Groups we create are always public (tags only), but other
 * Nostr apps may add NIP-51 private items: a JSON tag array encrypted to ourselves
 * in `content`. Those are merged in. Returns null for sets we can't read (e.g. old
 * NIP-04 encryption) or that were deleted.
 */
export async function parseGroup(event: Event, decrypt: Crypt): Promise<Group | null> {
  const id = event.tags.find((t) => t[0] === 'd')?.[1]
  if (event.kind !== FOLLOW_SET_KIND || !id || event.tags.some((t) => t[0] === 'deleted')) return null

  let title = event.tags.find((t) => t[0] === 'title')?.[1] ?? ''
  const members = event.tags.filter((t) => t[0] === 'p' && isPubkey(t[1])).map((t) => t[1])

  if (event.content) {
    if (event.content.includes('?iv=')) return null // NIP-04, which we don't support
    try {
      const items = JSON.parse(await decrypt(event.content))
      if (!Array.isArray(items)) return null
      for (const item of items) {
        if (!Array.isArray(item)) continue
        if (item[0] === 'p' && isPubkey(item[1])) members.push(item[1])
        if (item[0] === 'title' && typeof item[1] === 'string') title = item[1]
      }
    } catch {
      return null
    }
  }

  return {
    id,
    title: title || 'Untitled group',
    members: [...new Set(members)],
    createdAt: event.created_at,
  }
}

/** Groups are public: a game for a group lists its invitees publicly anyway. */
export function buildGroup(group: Omit<Group, 'createdAt'>): EventTemplate {
  return {
    kind: FOLLOW_SET_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', group.id], ['title', group.title], ...group.members.map((p) => ['p', p]), ['alt', `Group: ${group.title}`]],
    content: '',
  }
}

/** NIP-09 deletion request, plus an emptied replacement for relays that ignore deletions. */
export function buildGroupDeletion(owner: string, id: string): { deletion: EventTemplate; tombstone: EventTemplate } {
  const created_at = Math.floor(Date.now() / 1000)
  return {
    deletion: { kind: DELETION_KIND, created_at, content: 'Group deleted', tags: [['a', `${FOLLOW_SET_KIND}:${owner}:${id}`], ['k', String(FOLLOW_SET_KIND)]] },
    tombstone: { kind: FOLLOW_SET_KIND, created_at, content: '', tags: [['d', id], ['deleted']] },
  }
}
