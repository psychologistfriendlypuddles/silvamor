import { create } from 'zustand'
import { TRANSIENT, type Notice } from '../lib/notifications'

export interface StoredNotice extends Notice {
  /** Game title when the notice was made, for display. */
  title: string
  read: boolean
}

const MAX_KEPT = 150
const storageKey = (pubkey: string) => `silvamor:notices:${pubkey}`

interface NotificationsState {
  pubkey: string | null
  /** Newest first. */
  items: StoredNotice[]
  load(pubkey: string): void
  /** Takes a game's current notices; returns the ones not seen before. */
  merge(coordinate: string, current: Notice[], title: string): StoredNotice[]
  markRead(id: string): void
  markGameRead(coordinate: string): void
  markAllRead(): void
}

export const useNotifications = create<NotificationsState>((set, get) => {
  const save = (items: StoredNotice[]) => {
    const kept = items.slice(0, MAX_KEPT)
    set({ items: kept })
    const pubkey = get().pubkey
    if (!pubkey) return
    try {
      localStorage.setItem(storageKey(pubkey), JSON.stringify(kept))
    } catch {
      /* storage full or unavailable: keep them in memory */
    }
  }

  return {
    pubkey: null,
    items: [],

    load(pubkey) {
      let items: StoredNotice[] = []
      try {
        items = JSON.parse(localStorage.getItem(storageKey(pubkey)) ?? '[]')
      } catch {
        /* corrupt: start over */
      }
      set({ pubkey, items })
    },

    merge(coordinate, current, title) {
      const { items } = get()
      const known = new Set(items.map((n) => n.id))
      const currentIds = new Set(current.map((n) => n.id))
      const fresh = current.filter((n) => !known.has(n.id)).map((n) => ({ ...n, title, read: false }))
      // "Your turn" and "1 block left" are done once the moment has passed.
      const updated = items.map((n) =>
        n.coordinate === coordinate && !n.read && TRANSIENT.includes(n.kind) && !currentIds.has(n.id) ? { ...n, read: true } : n,
      )
      if (fresh.length === 0 && updated.every((n, i) => n === items[i])) return []
      save([...fresh.sort((a, b) => b.at - a.at), ...updated].sort((a, b) => b.at - a.at))
      return fresh
    },

    markRead(id) {
      save(get().items.map((n) => (n.id === id ? { ...n, read: true } : n)))
    },

    markGameRead(coordinate) {
      if (!get().items.some((n) => n.coordinate === coordinate && !n.read)) return
      save(get().items.map((n) => (n.coordinate === coordinate ? { ...n, read: true } : n)))
    },

    markAllRead() {
      save(get().items.map((n) => ({ ...n, read: true })))
    },
  }
})

export const useUnreadCount = () => useNotifications((s) => s.items.filter((n) => !n.read).length)
