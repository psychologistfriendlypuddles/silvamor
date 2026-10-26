import { create } from 'zustand'
import { DEFAULT_RELAYS, DISCOVERY_RELAYS, GAME_RELAYS, normalizeRelayUrl, pool, publishTo } from '../lib/nostr/pool'
import { RELAY_LIST_KIND, buildRelayListEvent, parseRelayList, type RelayEntry } from '../lib/nostr/relayList'
import type { AppSigner } from '../lib/nostr/signers'

const cacheKey = (pubkey: string) => `silvamor:relays:${pubkey}`

const defaults = (): RelayEntry[] => DEFAULT_RELAYS.map((url) => ({ url, read: true, write: true }))

interface RelayState {
  relays: RelayEntry[]
  /** The list as last published, so we know whether there are unsaved changes. */
  published: RelayEntry[]
  loading: boolean
  /** True when the user has no NIP-65 list anywhere and we're showing defaults. */
  usingDefaults: boolean

  load(pubkey: string): Promise<void>
  add(input: string): void
  remove(url: string): void
  toggle(url: string, field: 'read' | 'write'): void
  reset(): void
  save(signer: AppSigner, pubkey: string): Promise<string[]>
}

export const useRelays = create<RelayState>((set, get) => ({
  relays: defaults(),
  published: defaults(),
  loading: false,
  usingDefaults: true,

  async load(pubkey) {
    try {
      const cached = localStorage.getItem(cacheKey(pubkey))
      if (cached) {
        const relays = JSON.parse(cached) as RelayEntry[]
        set({ relays, published: relays, usingDefaults: false })
      }
    } catch {
      /* ignore a corrupt cache */
    }

    set({ loading: true })
    const event = await pool.get(DISCOVERY_RELAYS, { kinds: [RELAY_LIST_KIND], authors: [pubkey] }, { maxWait: 4000 })
    set({ loading: false })
    if (!event) return

    const relays = parseRelayList(event)
    if (relays.length === 0) return
    localStorage.setItem(cacheKey(pubkey), JSON.stringify(relays))
    set({ relays, published: relays, usingDefaults: false })
  },

  add(input) {
    const url = normalizeRelayUrl(input)
    if (!url) throw new Error('Relay addresses look like wss://relay.example.com')
    if (get().relays.some((r) => r.url === url)) throw new Error('That relay is already in your list.')
    set({ relays: [...get().relays, { url, read: true, write: true }] })
  },

  remove(url) {
    set({ relays: get().relays.filter((r) => r.url !== url) })
  },

  toggle(url, field) {
    set({ relays: get().relays.map((r) => (r.url === url ? { ...r, [field]: !r[field] } : r)) })
  },

  reset() {
    set({ relays: get().published })
  },

  async save(signer, pubkey) {
    if (get().usingDefaults) {
      // We may only be showing defaults because the user's list was slow to load.
      // Never replace a real NIP-65 list without looking for it once more.
      const existing = await pool.get(DISCOVERY_RELAYS, { kinds: [RELAY_LIST_KIND], authors: [pubkey] }, { maxWait: 8000 })
      const found = existing ? parseRelayList(existing) : []
      if (found.length > 0) {
        localStorage.setItem(cacheKey(pubkey), JSON.stringify(found))
        set({ relays: found, published: found, usingDefaults: false })
        throw new Error('Found your existing relay list and loaded it instead. Make your changes again, then save.')
      }
    }
    const { relays, published } = get()
    if (!relays.some((r) => r.write)) throw new Error('Keep at least one relay you write to.')
    const event = await signer.signEvent(buildRelayListEvent(relays))
    // Tell the old relays, the new relays and the indexers, so everyone can find the update.
    const targets = [...new Set([...relays, ...published].filter((r) => r.write).map((r) => r.url).concat(DISCOVERY_RELAYS))]
    const ok = await publishTo(targets, event)
    localStorage.setItem(cacheKey(pubkey), JSON.stringify(relays))
    set({ published: relays, usingDefaults: false })
    return ok
  },
}))

export const readRelays = (relays: RelayEntry[]) => relays.filter((r) => r.read).map((r) => r.url)
export const writeRelays = (relays: RelayEntry[]) => relays.filter((r) => r.write).map((r) => r.url)

/** Where to look for game events: the user's read relays plus the shared game relays. */
export const gameReadRelays = (extra: string[] = []) => [...new Set([...readRelays(useRelays.getState().relays), ...GAME_RELAYS, ...extra])]
/** Where to publish game events, so opponents and spectators on the shared relays see them. */
export const gameWriteRelays = (extra: string[] = []) => [...new Set([...writeRelays(useRelays.getState().relays), ...GAME_RELAYS, ...extra])]
