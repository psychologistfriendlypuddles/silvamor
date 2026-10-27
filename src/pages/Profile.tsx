import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import * as nip19 from 'nostr-tools/nip19'
import { BadgeCheck, CircleX, Globe, ImageUp, LogOut, Save, Trash2, TriangleAlert, Zap } from 'lucide-react'
import { useSession, useSigner } from '../stores/session'
import { useProfiles } from '../stores/profiles'
import { useRelays, writeRelays } from '../stores/relays'
import { LUD16_REGEX, verifyNip05, type ProfileContent } from '../lib/nostr/profile'
import { uploadToBlossom } from '../lib/blossom'
import { HOME_RELAY } from '../lib/nostr/pool'
import { forgetLocalData, requestVanish } from '../lib/nostr/vanish'
import { disablePush, isPushEnabled, savedPushServer } from '../lib/push'
import { toast } from '../stores/toast'
import { Avatar } from '../components/Avatar'
import { Button, Card, Field, PageTitle, Spinner } from '../components/ui'
import { CopyButton } from './Login'
import { WalletCard } from '../components/WalletCard'
import { SpriteCard } from '../components/SpriteCard'
import { LegalLinks } from '../components/LegalLinks'

const FIELDS = ['display_name', 'name', 'about', 'picture', 'nip05', 'lud16', 'website'] as const
type Form = Record<(typeof FIELDS)[number], string>

const toForm = (p: ProfileContent | undefined): Form =>
  Object.fromEntries(FIELDS.map((f) => [f, typeof p?.[f] === 'string' ? (p[f] as string) : ''])) as Form

export function ProfilePage() {
  const { pubkey } = useSigner()
  const cached = useProfiles((s) => s.profiles[pubkey])
  const loading = useProfiles((s) => s.pending[pubkey])

  return (
    <div>
      <PageTitle emoji="🎨" title="Your Profile" subtitle="This is your Nostr profile. It shows up in every Nostr app." />
      {loading && !cached ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : (
        // Re-mount the form when a newer profile arrives from the relays.
        <ProfileForm key={cached?.createdAt ?? 0} initial={cached?.content} />
      )}
      <div className="mt-5">
        <SpriteCard />
      </div>
      <div className="mt-5">
        <WalletCard pubkey={pubkey} />
      </div>
      <LogOutCard />
      <DeleteDataCard />
      <LegalLinks className="mt-5" center />
    </div>
  )
}

function ProfileForm({ initial }: { initial: ProfileContent | undefined }) {
  const { signer, pubkey } = useSigner()
  const relays = useRelays((s) => s.relays)
  const save = useProfiles((s) => s.save)
  const [form, setForm] = useState<Form>(() => toForm(initial))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [nip05Status, setNip05Status] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const fileInput = useRef<HTMLInputElement>(null)
  const npub = nip19.npubEncode(pubkey)
  const dirty = FIELDS.some((f) => form[f] !== toForm(initial)[f])
  const lud16Error = form.lud16 && !LUD16_REGEX.test(form.lud16) ? 'Lightning addresses look like you@wallet.com' : null

  const set = (field: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }))

  // Check the NIP-05 identifier shortly after the user stops typing.
  useEffect(() => {
    const value = form.nip05.trim()
    if (!value) return
    let cancelled = false
    const t = setTimeout(async () => {
      setNip05Status('checking')
      const ok = await verifyNip05(pubkey, value)
      if (!cancelled) setNip05Status(ok ? 'valid' : 'invalid')
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [form.nip05, pubkey])

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file.')
    setUploading(true)
    try {
      const url = await uploadToBlossom(file, signer)
      setForm((f) => ({ ...f, picture: url }))
      toast.success('Picture uploaded. Remember to save!')
    } catch (err) {
      toast.error(err)
    } finally {
      setUploading(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lud16Error) return
    setSaving(true)
    try {
      const ok = await save(signer, pubkey, form, writeRelays(relays))
      toast.success(`Profile saved to ${ok.length} relay${ok.length === 1 ? '' : 's'} 🎉`)
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  const nip05Badge = form.nip05.trim()
    ? {
        idle: null,
        checking: <Spinner className="size-5" />,
        valid: <BadgeCheck className="size-5 text-mint" />,
        invalid: <CircleX className="size-5 text-rose-300" />,
      }[nip05Status]
    : null

  return (
    <form onSubmit={submit} className="grid gap-5 md:grid-cols-[16rem_1fr]">
      <Card className="flex flex-col items-center gap-4 self-start text-center">
        <motion.div whileHover={{ scale: 1.05, rotate: 2 }} className="relative">
          <Avatar pubkey={pubkey} src={form.picture || undefined} className="size-32 text-5xl" />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-night-950/70">
              <Spinner />
            </div>
          )}
        </motion.div>
        <div className="min-w-0">
          <p className="truncate text-xl font-bold">{form.display_name || form.name || 'Anonymous'}</p>
          {form.nip05 && nip05Status === 'valid' && <p className="truncate text-sm text-mint">{form.nip05.replace(/^_@/, '')}</p>}
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button type="button" variant="secondary" className="w-full" icon={<ImageUp className="size-5" />} loading={uploading} onClick={() => fileInput.current?.click()}>
          Upload picture
        </Button>
        <div className="w-full rounded-2xl bg-night-950/60 p-3 text-left">
          <p className="mb-1 text-xs font-medium text-white/50">Your public key (share this)</p>
          <p className="mb-2 font-mono text-xs break-all text-white/70">{npub}</p>
          <CopyButton text={npub} label="Copy npub" />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" placeholder="Captain Zap" value={form.display_name} onChange={set('display_name')} />
          <Field label="Username" placeholder="captainzap" value={form.name} onChange={set('name')} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-white/70">About</span>
          <textarea
            rows={3}
            value={form.about}
            onChange={set('about')}
            placeholder="Chasing a straight flush since 2009."
            className="w-full resize-none rounded-2xl border-2 border-white/10 bg-night-950/60 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-grape"
          />
        </label>
        <Field
          label="Profile picture URL"
          placeholder="https://…"
          value={form.picture}
          onChange={set('picture')}
          hint="Or use the upload button. Images are stored on a Blossom server."
        />
        <Field
          label="NIP-05 identifier"
          placeholder="you@yourdomain.com"
          value={form.nip05}
          onChange={set('nip05')}
          trailing={nip05Badge}
          error={nip05Status === 'invalid' && form.nip05.trim() ? "That domain doesn't list your public key (yet)." : null}
          hint="A human-friendly address that proves you own a domain name."
        />
        <Field
          label="Lightning address"
          placeholder="you@walletofsatoshi.com"
          value={form.lud16}
          onChange={set('lud16')}
          error={lud16Error}
          trailing={<Zap className="size-5 text-lemon" />}
          hint="Where zaps and tips get paid."
        />
        <Field
          label="Website"
          placeholder="https://…"
          value={form.website}
          onChange={set('website')}
          trailing={<Globe className="size-5 text-white/40" />}
        />
        <AnimatePresence>
          {dirty && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setForm(toForm(initial))}>
                Discard
              </Button>
              <Button type="submit" loading={saving} disabled={!!lud16Error} icon={<Save className="size-5" />}>
                Save profile
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </form>
  )
}

/** The way out on every screen size (phones have no sidebar with a log-out button). */
function LogOutCard() {
  const { method, logout } = useSession()
  const [confirming, setConfirming] = useState(false)
  const how = {
    nip07: 'your browser extension',
    nip46: 'your signer app',
    nsec: 'your private key (nsec)',
  }[method ?? 'nsec']
  return (
    <Card className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold">Log out</p>
        <p className="text-sm text-white/50">Signs you out on this device. You'll need {how} to log back in.</p>
      </div>
      {confirming ? (
        <span className="flex gap-2">
          <Button variant="danger" icon={<LogOut className="size-4" />} onClick={() => logout()}>
            Log out
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Stay
          </Button>
        </span>
      ) : (
        <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => setConfirming(true)}>
          Log out
        </Button>
      )}
    </Card>
  )
}

const HOME_NAME = HOME_RELAY.replace(/^wss?:\/\//, '')

/** Deletes what this key published on Silvamor's relay (a NIP-62 request to vanish), then signs out. */
function DeleteDataCard() {
  const { signer, pubkey } = useSigner()
  const logout = useSession((s) => s.logout)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    try {
      // The push service keeps this key's push address: drop it while we can still sign for it.
      if (await isPushEnabled(pubkey).catch(() => false)) await disablePush(pubkey, savedPushServer(pubkey), signer).catch(() => {})
      await requestVanish(signer)
      forgetLocalData(pubkey)
      await logout()
      toast.success(`Your data was deleted from ${HOME_NAME}.`)
    } catch (err) {
      toast.error(err)
      setDeleting(false)
    }
  }

  return (
    <Card className="mt-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Delete my data</p>
          <p className="text-sm text-white/50">Wipes everything this key published on {HOME_NAME}.</p>
        </div>
        {!confirming && (
          <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={() => setConfirming(true)}>
            Delete my data
          </Button>
        )}
      </div>
      {confirming && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border-2 border-rose-400/40 bg-rose-500/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-rose-200">
            <TriangleAlert className="size-5 shrink-0" /> This can't be undone
          </p>
          <p className="text-white/70">
            All information stored about you on <b className="text-white">{HOME_NAME}</b> will be wiped: your profile, follow list, relay list,
            Daily Deal runs, groups, sprites, settings and reports. Leaderboards will no longer show you, and push notifications are turned off.
          </p>
          <p className="text-white/70">
            Copies on other relays and in other Nostr apps aren't affected, and your key keeps working. You'll be signed out, and this device
            forgets your Silvamor data.
          </p>
          <span className="flex flex-wrap gap-2">
            <Button variant="danger" loading={deleting} icon={<Trash2 className="size-4" />} onClick={remove}>
              Delete everything
            </Button>
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        </div>
      )}
    </Card>
  )
}
