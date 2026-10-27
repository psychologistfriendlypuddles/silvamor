import { create } from 'zustand'
import type { Notice } from '../lib/notifications'

export interface StoredNotice extends Notice {
  read: boolean
}

const MAX_KEPT = 150
// v2: notices from the retired two-player games are left behind.
const storageKey = (pubkey: string) => `silvamor:notices:v2:${pubkey}`

interface NotificationsState {
  pubkey: string | null
  /** Newest first. */
  items: StoredNotice[]
  load(pubkey: string): void
  /** Adds a notice; false if it was already there. */
  add(notice: Notice): boolean
  markRead(id: string): void
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

    add(notice) {
      if (get().items.some((n) => n.id === notice.id)) return false
      save([{ ...notice, read: false }, ...get().items].sort((a, b) => b.at - a.at))
      return true
    },

    markRead(id) {
      save(get().items.map((n) => (n.id === id ? { ...n, read: true } : n)))
    },

    markAllRead() {
      save(get().items.map((n) => ({ ...n, read: true })))
    },
  }
})

export const useUnreadCount = () => useNotifications((s) => s.items.filter((n) => !n.read).length)
