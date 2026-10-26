import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fetchRelayInformation, type RelayInformation } from 'nostr-tools/nip11'
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { normalizeRelayUrl, pool } from '../lib/nostr/pool'
import type { RelayEntry } from '../lib/nostr/relayList'
import { useSigner } from '../stores/session'
import { useRelays } from '../stores/relays'
import { toast } from '../stores/toast'
import { Button, Card, Field, PageTitle } from '../components/ui'

type Status = 'connecting' | 'online' | 'offline'

export function RelaysPage() {
  const { signer, pubkey } = useSigner()
  const { relays, published, usingDefaults, add, remove, toggle, reset, save } = useRelays()
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(relays) !== JSON.stringify(published)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    try {
      add(input)
      setInput('')
    } catch (err) {
      toast.error(err)
    }
  }

  const publish = async () => {
    setSaving(true)
    try {
      const ok = await save(signer, pubkey)
      toast.success(`Relay list published to ${ok.length} relays`)
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageTitle emoji="📡" title="Relays" subtitle="Relays carry your games and moves. Use a few you trust, including your own." />

      {usingDefaults && (
        <Card className="mb-4 border-lemon/30 bg-lemon/5 text-sm text-lemon">
          You don't have a relay list on Nostr yet, so we're using some popular defaults. Save to publish your own (NIP-65).
        </Card>
      )}

      <form onSubmit={submit} className="mb-4 flex items-end gap-2">
        <Field className="flex-1" label="Add a relay" placeholder="wss://relay.example.com" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" disabled={!input.trim()} icon={<Plus className="size-5" />} className="h-[52px]">
          Add
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {relays.map((relay) => (
            <RelayRow key={relay.url} relay={relay} onToggle={(f) => toggle(relay.url, f)} onRemove={() => remove(relay.url)} />
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="sticky bottom-24 mt-6 flex justify-end gap-2 md:bottom-6"
          >
            <Button variant="secondary" icon={<RotateCcw className="size-5" />} onClick={reset}>
              Undo
            </Button>
            <Button loading={saving} icon={<Save className="size-5" />} onClick={publish}>
              Save relay list
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function RelayRow({ relay, onToggle, onRemove }: { relay: RelayEntry; onToggle: (f: 'read' | 'write') => void; onRemove: () => void }) {
  const status = useRelayStatus(relay.url)
  const [info, setInfo] = useState<RelayInformation | null>(null)

  useEffect(() => {
    fetchRelayInformation(relay.url).then(setInfo, () => {})
  }, [relay.url])

  const dot = { connecting: 'bg-lemon animate-pulse', online: 'bg-mint', offline: 'bg-rose-400' }[status]

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: -40 }}>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        {info?.icon ? (
          <img src={info.icon} alt="" className="size-10 rounded-xl object-cover" />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-xl bg-night-700 text-lg">📡</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-full ${dot}`} title={status} />
            <span className="truncate font-medium">{info?.name || relay.url.replace(/^wss?:\/\//, '')}</span>
          </div>
          <p className="truncate font-mono text-xs text-white/45">{relay.url}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Chip active={relay.read} onClick={() => onToggle('read')} color="bg-sky/20 text-sky">
            Read
          </Chip>
          <Chip active={relay.write} onClick={() => onToggle('write')} color="bg-bubblegum/20 text-bubblegum">
            Write
          </Chip>
          <button onClick={onRemove} className="ml-1 rounded-xl p-2 text-white/40 hover:bg-rose-500/15 hover:text-rose-300" title="Remove">
            <Trash2 className="size-4" />
          </button>
        </div>
      </Card>
    </motion.div>
  )
}

function Chip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: string; children: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${active ? color : 'bg-white/5 text-white/35 line-through'}`}
    >
      {children}
    </motion.button>
  )
}

function useRelayStatus(url: string): Status {
  const [status, setStatus] = useState<Status>('connecting')
  useEffect(() => {
    let cancelled = false
    pool.ensureRelay(url, { connectionTimeout: 5000 }).then(
      () => !cancelled && setStatus('online'),
      () => !cancelled && setStatus('offline'),
    )
    // Keep the dot honest if a relay drops later.
    const interval = setInterval(() => {
      for (const [relayUrl, connected] of pool.listConnectionStatus()) {
        if (normalizeRelayUrl(relayUrl) === url) setStatus(connected ? 'online' : 'offline')
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [url])
  return status
}
