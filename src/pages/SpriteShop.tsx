import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Check, EyeOff, Flag, Heart, ImageUp, ShieldCheck, Star, X } from 'lucide-react'
import { BUILTIN_SPRITES, type Sprite } from '../lib/sprites'
import { formatSats } from '../lib/zaps'
import { useSigner } from '../stores/session'
import { usePlayerSprite, useSprites } from '../stores/sprites'
import { useModeration, useSpriteBlock } from '../stores/moderation'
import { MAX_REPORT_NOTE, REPORT_REASONS, REPORT_THRESHOLD, type ModerationSettings, type ReportReason } from '../lib/moderation'
import { toast } from '../stores/toast'
import { useDisplayName } from '../hooks/useDisplayName'
import { useZappable } from '../hooks/useZappable'
import { useZapPay } from '../hooks/useZapPay'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { SpriteView } from '../components/Sprite'
import { SpriteMaker, SpritePreview } from '../components/SpriteCard'
import { PayButtons } from '../components/ZapPay'
import { Button, PageTitle, Spinner } from '../components/ui'
import { PlayerSheet } from '../components/PlayerSheet'

type Tab = 'featured' | 'all' | 'mine'
const TABS: { value: Tab; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Yours' },
]
const TIPS = [21, 210, 2100]

export function SpriteShopPage() {
  const { signer, pubkey } = useSigner()
  const catalog = useSprites((s) => s.catalog)
  const sprites = useSprites((s) => s.sprites)
  const current = usePlayerSprite(pubkey)
  const [tab, setTab] = useState<Tab>('featured')
  const [open, setOpen] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [safety, setSafety] = useState(false)
  const featuredBy = useModeration((s) => s.featured)
  const { settings, muted } = useModeration()

  // How many curators / people you follow (or you) feature each sprite.
  const picks = useMemo(() => {
    const count = new Map<string, number>()
    for (const ids of Object.values(featuredBy)) for (const id of new Set(ids)) count.set(id, (count.get(id) ?? 0) + 1)
    return count
  }, [featuredBy])

  useEffect(() => {
    void useSprites.getState().loadCatalog()
  }, [pubkey])
  useEffect(() => {
    void useSprites.getState().loadSprites([...picks.keys()])
  }, [picks])

  const list = useMemo(() => {
    const hidden = new Set([...settings.hiddenArtists, ...muted])
    const ids = new Set([...(catalog ?? []), ...picks.keys()])
    const all = [...BUILTIN_SPRITES, ...[...ids].map((id) => sprites[id]).filter(Boolean)].filter((s) => !s.author || !hidden.has(s.author))
    const mine = (s: Sprite) => !s.author || s.author === pubkey
    if (tab === 'featured') return all.filter((s) => picks.has(s.id)).sort((a, b) => picks.get(b.id)! - picks.get(a.id)!)
    return tab === 'mine' ? all.filter(mine) : all
  }, [catalog, sprites, tab, pubkey, picks, settings.hiddenArtists, muted])

  return (
    <div>
      <PageTitle emoji="🛍️" title="Sprite shop" subtitle="Pick a sprite to stand in your corner of every game. Paid sprites send your sats straight to the artist." />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-2xl bg-night-900/70 p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors ${tab === t.value ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<ImageUp className="size-4" />} onClick={() => setMaking(true)}>
            Share a sprite
          </Button>
          <Button variant="ghost" icon={<ShieldCheck className="size-4" />} onClick={() => setSafety(true)} aria-label="Shop safety" />
        </div>
      </div>

      {catalog === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <p className="py-16 text-center text-white/50">
          {tab === 'featured' ? (
            <>
              No picks yet. Tap ⭐ on sprites you like to feature them; picks from people you follow show up here too.{' '}
              <button onClick={() => setTab('all')} className="font-semibold text-mint hover:underline">
                Browse all
              </button>
            </>
          ) : (
            'Nothing here yet.'
          )}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((s) => (
            <ShopItem
              key={s.id}
              sprite={s}
              inUse={s.id === current.id}
              mine={s.author === pubkey}
              picks={picks.get(s.id) ?? 0}
              onOpen={() => setOpen(s.id)}
            />
          ))}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)}>
        {open && sprites[open] && <SpriteDetail sprite={sprites[open]} onClose={() => setOpen(null)} />}
      </Modal>
      <Modal open={safety} onClose={() => setSafety(false)}>
        <SafetySheet onClose={() => setSafety(false)} />
      </Modal>
      <Modal open={making} onClose={() => setMaking(false)}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-display">share a sprite ✨</h2>
            <button onClick={() => setMaking(false)} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close sprite maker">
              <X className="size-5" />
            </button>
          </div>
          <SpriteMaker
            onDone={(sprite) => {
              setMaking(false)
              if (!sprite) return
              void useSprites.getState().loadCatalog()
              setOpen(sprite.id)
              // "Publish and use it": switch to it straight away.
              useSprites
                .getState()
                .choose(signer, pubkey, sprite.id)
                .then(() => toast.success(`${sprite.name} is now your sprite ✨`), toast.error)
            }}
          />
        </div>
      </Modal>
    </div>
  )
}

function ShopItem({ sprite, inUse, mine, picks, onOpen }: { sprite: Sprite; inUse: boolean; mine: boolean; picks: number; onOpen(): void }) {
  const artist = useDisplayName(sprite.author ?? '')
  const blocked = useSpriteBlock(sprite)
  return (
    <motion.button
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      aria-label={sprite.name}
      className={`relative flex flex-col items-center gap-2 rounded-3xl border-2 bg-night-900/70 p-3 text-center ${inUse ? 'border-lemon' : 'border-white/10 hover:border-white/25'}`}
    >
      {inUse && <Check className="absolute top-2 right-2 size-4 text-lemon" />}
      {picks > 0 && <span className="absolute top-2 left-2 text-xs font-semibold text-lemon">⭐ {picks}</span>}
      <Blurred on={blocked === 'reported'}>
        <SpriteView sprite={sprite} size={88} />
      </Blurred>
      <span className="w-full truncate font-semibold">{sprite.name}</span>
      <span className="w-full truncate text-xs text-white/50">by {sprite.author ? artist : 'Silvamor'}</span>
      {mine && sprite.author && <span className="rounded-full bg-grape/20 px-2 py-0.5 text-[11px] font-semibold text-grape">Yours</span>}
    </motion.button>
  )
}

function SpriteDetail({ sprite, onClose }: { sprite: Sprite; onClose(): void }) {
  const { signer, pubkey } = useSigner()
  const current = usePlayerSprite(pubkey)
  const artist = useDisplayName(sprite.author ?? '')
  const mine = sprite.author === pubkey
  const [using, setUsing] = useState(false)
  const blocked = useSpriteBlock(sprite)
  const [shown, setShown] = useState(false)
  const [artistOpen, setArtistOpen] = useState(false)

  const use = async () => {
    setUsing(true)
    try {
      await useSprites.getState().choose(signer, pubkey, sprite.id)
      toast.success(`${sprite.name} is now your sprite ✨`)
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setUsing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-display">{sprite.name}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-white/55">
            {sprite.author ? (
              <button onClick={() => setArtistOpen(true)} className="flex items-center gap-2 hover:text-white" aria-label={`${artist}'s profile`}>
                <Avatar pubkey={sprite.author} className="size-6 text-[10px]" />
                by <span className="underline-offset-2 hover:underline">{artist}</span>
              </button>
            ) : (
              'by Silvamor'
            )}
          </p>
          <PlayerSheet pubkey={artistOpen ? sprite.author : null} onClose={() => setArtistOpen(false)} />
        </div>
        <button onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close sprite">
          <X className="size-5" />
        </button>
      </div>

      <Blurred on={blocked === 'reported' && !shown} onShow={() => setShown(true)} big>
        <SpritePreview sprite={sprite} size={160} />
      </Blurred>

      {sprite.author && <SpriteActions sprite={sprite} onHidden={onClose} />}

      {current.id === sprite.id ? (
        <p className="flex items-center justify-center gap-2 rounded-2xl bg-lemon/10 p-3 text-sm font-semibold text-lemon">
          <Check className="size-4" /> This is your sprite
        </p>
      ) : blocked ? (
        <p className="rounded-2xl bg-white/5 p-3 text-center text-sm text-white/55">
          {blocked === 'hidden' ? "You've hidden this artist." : 'Reported by people you follow (or you), so it isn’t available to use.'}
        </p>
      ) : (
        <Button variant="lemon" loading={using} onClick={use} className="py-3">
          Use this sprite
        </Button>
      )}

      {sprite.author && !mine && !blocked && <TipPanel sprite={sprite} />}
    </div>
  )
}

/** Every sprite is free; players who like one can send the artist a tip (a zap), if they want to. */
function TipPanel({ sprite }: { sprite: Sprite }) {
  const artist = useDisplayName(sprite.author!)
  const canReceive = useZappable(sprite.author!)
  const [sats, setSats] = useState<number | null>(null)
  if (canReceive === false) return null
  return (
    <div className="flex flex-col gap-3 rounded-3xl bg-white/5 p-4">
      <p className="flex items-center gap-2 text-sm text-white/65">
        <Heart className="size-4 shrink-0 text-bubblegum" /> Like it? Send {artist} a tip. Totally optional: every sprite is free to use.
      </p>
      <div className="flex flex-wrap gap-2">
        {TIPS.map((t) => (
          <button
            key={t}
            onClick={() => setSats(t)}
            className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              sats === t ? 'border-lemon bg-lemon/10 text-white' : 'border-white/10 text-white/60 hover:border-white/25'
            }`}
          >
            ⚡ {formatSats(t)}
          </button>
        ))}
      </div>
      {/* A fresh invoice for each amount. */}
      {sats && <TipButtons key={sats} sprite={sprite} sats={sats} artist={artist} />}
    </div>
  )
}

function TipButtons({ sprite, sats, artist }: { sprite: Sprite; sats: number; artist: string }) {
  const zap = useZapPay({
    recipient: sprite.author!,
    sats,
    coordinate: sprite.id,
    content: `Tip for your Silvamor sprite: ${sprite.name}`,
    successText: `Tipped ${artist} ${formatSats(sats)} ⚡ Thank you!`,
  })
  return <PayButtons zap={zap} label="Tip" />
}

/** Blurs a reported sprite until the viewer chooses to look. */
function Blurred({ on, onShow, big, children }: { on: boolean; onShow?(): void; big?: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>
  return (
    <div className="relative">
      <div className="pointer-events-none blur-xl select-none" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center text-xs font-semibold text-white/80">
        <EyeOff className={big ? 'size-6' : 'size-5'} />
        Reported
        {onShow && (
          <button onClick={onShow} className="rounded-full bg-white/15 px-3 py-1 hover:bg-white/25">
            Show anyway
          </button>
        )}
      </div>
    </div>
  )
}

// A stable empty list: a fresh [] from a store selector would re-render forever.
const NO_PICKS: string[] = []

/** Feature (⭐), hide the artist, or report: the shop's community moderation. */
function SpriteActions({ sprite, onHidden }: { sprite: Sprite; onHidden(): void }) {
  const { signer, pubkey } = useSigner()
  const mine = useModeration((s) => s.featured[pubkey] ?? NO_PICKS)
  const settings = useModeration((s) => s.settings)
  const artist = useDisplayName(sprite.author!)
  const featured = mine.includes(sprite.id)
  const [reporting, setReporting] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          icon={<Star className={`size-4 ${featured ? 'fill-lemon text-lemon' : ''}`} />}
          aria-label={featured ? 'Remove from my picks' : 'Feature this sprite'}
          onClick={() =>
            run(
              () => useModeration.getState().setFeatured(signer, featured ? mine.filter((id) => id !== sprite.id) : [...mine, sprite.id]),
              featured ? 'Removed from your picks' : 'Added to your picks ⭐',
            )
          }
        >
          {featured ? 'Featured' : 'Feature'}
        </Button>
        {sprite.author !== pubkey && (
          <>
            <Button
              variant="ghost"
              disabled={busy}
              icon={<EyeOff className="size-4" />}
              onClick={() =>
                run(async () => {
                  await useModeration.getState().saveSettings(signer, { ...settings, hiddenArtists: [...new Set([...settings.hiddenArtists, sprite.author!])] })
                  onHidden()
                }, `Hid sprites by ${artist}`)
              }
            >
              Hide artist
            </Button>
            <Button variant="ghost" disabled={busy} icon={<Flag className="size-4" />} onClick={() => setReporting(!reporting)}>
              Report
            </Button>
          </>
        )}
      </div>
      {reporting && <ReportForm sprite={sprite} onDone={() => setReporting(false)} />}
    </div>
  )
}

function ReportForm({ sprite, onDone }: { sprite: Sprite; onDone(): void }) {
  const { signer } = useSigner()
  const [reason, setReason] = useState<ReportReason>('nudity')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await useModeration.getState().report(signer, sprite, reason, note)
      toast.success('Reported. Thanks for keeping the shop friendly.')
      onDone()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 p-3 text-sm">
      <p className="text-white/60">
        Reports are public Nostr events (NIP-56). When {REPORT_THRESHOLD} or more people someone follows report a sprite, their app can blur it. It’s
        also hidden for you right away.
      </p>
      <div className="flex flex-col gap-1">
        {REPORT_REASONS.map((r) => (
          <label key={r.value} className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="reason" checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-bubblegum" />
            {r.label}
          </label>
        ))}
      </div>
      <textarea
        aria-label="Report details"
        placeholder="Anything else? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={MAX_REPORT_NOTE}
        rows={2}
        className="rounded-xl border-2 border-white/10 bg-night-900 p-2 outline-none focus:border-grape"
      />
      <div className="flex gap-2">
        <Button variant="danger" loading={busy} onClick={submit}>
          Send report
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Shop safety settings: blur reported sprites, and the artists you've hidden. */
function SafetySheet({ onClose }: { onClose(): void }) {
  const { signer } = useSigner()
  const settings = useModeration((s) => s.settings)
  const muted = useModeration((s) => s.muted)
  const [busy, setBusy] = useState(false)
  const save = async (next: ModerationSettings) => {
    setBusy(true)
    try {
      await useModeration.getState().saveSettings(signer, next)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display">shop safety</h2>
        <button onClick={onClose} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close safety">
          <X className="size-5" />
        </button>
      </div>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={settings.blurReported}
          disabled={busy}
          onChange={(e) => save({ ...settings, blurReported: e.target.checked })}
          className="mt-0.5 size-5 accent-lemon"
        />
        <span>
          <b>Blur reported sprites.</b> When {REPORT_THRESHOLD}+ people you follow report a sprite, blur it in the shop and show the default
          ostrich instead of it everywhere else.
        </span>
      </label>
      <div className="flex flex-col gap-2">
        <p className="font-semibold">Hidden artists</p>
        {settings.hiddenArtists.length === 0 ? (
          <p className="text-white/50">None. Use “Hide artist” on a sprite to stop seeing that artist’s sprites.</p>
        ) : (
          settings.hiddenArtists.map((pk) => (
            <HiddenArtist key={pk} pubkey={pk} disabled={busy} onUnhide={() => save({ ...settings, hiddenArtists: settings.hiddenArtists.filter((p) => p !== pk) })} />
          ))
        )}
        {muted.length > 0 && <p className="text-xs text-white/40">People you’ve muted in any Nostr app ({muted.length}) are hidden too.</p>}
      </div>
      <p className="text-xs text-white/40">These settings are encrypted to you and follow you to your other devices.</p>
    </div>
  )
}

function HiddenArtist({ pubkey, disabled, onUnhide }: { pubkey: string; disabled: boolean; onUnhide(): void }) {
  const name = useDisplayName(pubkey)
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-2">
      <Avatar pubkey={pubkey} className="size-8 text-xs" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <Button variant="ghost" disabled={disabled} onClick={onUnhide}>
        Unhide
      </Button>
    </div>
  )
}
