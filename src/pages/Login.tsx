import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import QRCode from 'qrcode'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { createNostrConnectURI } from 'nostr-tools/nip46'
import { ArrowLeft, Check, Copy, KeyRound, Puzzle, Smartphone, Sparkles, TriangleAlert } from 'lucide-react'
import { deviceSignerKey, useSession } from '../stores/session'
import { NIP46_RELAYS, pool } from '../lib/nostr/pool'
import { NIP46_PERMS } from '../lib/nostr/signers'
import { toast } from '../stores/toast'
import { copyText } from '../lib/clipboard'
import { Button, Card, Field, Spinner, Toggle } from '../components/ui'
import { LogoMark, TAGLINE, Wordmark } from '../components/Brand'
import { LegalNote } from '../components/LegalLinks'

type Mode = 'menu' | 'signer' | 'nsec' | 'create'

export function LoginPage() {
  // After "Reconnect" on a stuck signer, go straight to the signer-app option.
  const [mode, setMode] = useState<Mode>(() => (useSession.getState().loginHint === 'signer' ? 'signer' : 'menu'))
  const [hasExtension, setHasExtension] = useState(false)

  useEffect(() => {
    // Extensions inject window.nostr shortly after load.
    const t = setTimeout(() => setHasExtension(!!window.nostr), 400)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <FloatingPieces />
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
        <div className="mb-3 flex flex-col items-center gap-3">
          <LogoMark className="h-48" />
          <Wordmark className="text-6xl sm:text-7xl" bounce />
        </div>
        <p className="font-display text-xl tracking-wide text-white/90">{TAGLINE}</p>
        <p className="mt-1 text-white/55">No accounts, no app stores, no game servers.</p>
      </motion.div>

      <Card layout className="w-full max-w-md" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, x: mode === 'menu' ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: mode === 'menu' ? 30 : -30 }}
            transition={{ duration: 0.18 }}
          >
            {mode === 'menu' && <Menu hasExtension={hasExtension} onPick={setMode} />}
            {mode !== 'menu' && (
              <button onClick={() => setMode('menu')} className="mb-4 flex items-center gap-1 text-sm text-white/60 hover:text-white">
                <ArrowLeft className="size-4" /> Back
              </button>
            )}
            {mode === 'signer' && <SignerLogin />}
            {mode === 'nsec' && <NsecLogin />}
            {mode === 'create' && <CreateAccount />}
          </motion.div>
        </AnimatePresence>
      </Card>
      <LegalNote className="mt-5 max-w-md" />
    </div>
  )
}

function Menu({ hasExtension, onPick }: { hasExtension: boolean; onPick: (m: Mode) => void }) {
  const loginExtension = useSession((s) => s.loginExtension)
  const [busy, setBusy] = useState(false)

  const useExtension = async () => {
    setBusy(true)
    try {
      await loginExtension()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="mb-1 text-xl font-display">Log in</h2>
      <MethodButton
        icon={<Puzzle />}
        color="bg-grape/20 text-grape"
        title="Browser extension"
        subtitle={hasExtension ? 'Extension detected. One click.' : 'Alby, nos2x, Nostr Connect…'}
        onClick={useExtension}
        busy={busy}
        highlight={hasExtension}
      />
      <MethodButton
        icon={<Smartphone />}
        color="bg-mint/20 text-mint"
        title="Signer app"
        subtitle="Amber, nsec.app, or any bunker (NIP-46)"
        onClick={() => onPick('signer')}
      />
      <MethodButton
        icon={<KeyRound />}
        color="bg-tangerine/20 text-tangerine"
        title="Private key"
        subtitle="Paste your nsec (stored encrypted)"
        onClick={() => onPick('nsec')}
      />
      <div className="my-2 h-px bg-white/10" />
      <Button variant="lemon" icon={<Sparkles className="size-5" />} onClick={() => onPick('create')}>
        New to Nostr? Create a key
      </Button>
    </div>
  )
}

function MethodButton(props: {
  icon: ReactNode
  color: string
  title: string
  subtitle: string
  onClick: () => void
  busy?: boolean
  highlight?: boolean
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={props.onClick}
      disabled={props.busy}
      className={`flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-colors ${
        props.highlight ? 'border-grape bg-grape/10' : 'border-white/10 bg-white/5 hover:border-white/25'
      }`}
    >
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl [&_svg]:size-6 ${props.color}`}>
        {props.busy ? <Spinner className="size-6" /> : props.icon}
      </span>
      <span>
        <span className="block font-semibold">{props.title}</span>
        <span className="block text-sm text-white/55">{props.subtitle}</span>
      </span>
    </motion.button>
  )
}

function SignerLogin() {
  const { loginNostrConnect, loginBunker } = useSession()
  const [{ clientSecret, uri }] = useState(() => {
    // Same app key every time on this device, so the signer app doesn't list a new connection per login.
    const clientSecret = deviceSignerKey()
    const uri = createNostrConnectURI({
      clientPubkey: getPublicKey(clientSecret),
      relays: NIP46_RELAYS,
      secret: bytesToHex(generateSecretKey()).slice(0, 16),
      name: 'Silvamor',
      url: location.origin,
      image: `${location.origin}/icons/icon-192.png`,
      perms: NIP46_PERMS,
    })
    return { clientSecret, uri }
  })
  const [qr, setQr] = useState<string | null>(null)
  const [bunkerInput, setBunkerInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [relayTrouble, setRelayTrouble] = useState(false)
  // Relays only pass the signer's answer on to whoever is listening right then, so a scan before
  // we're listening is lost: the QR code shows once we're connected to a connection relay.
  const [ready, setReady] = useState(false)

  // Show a nostrconnect:// QR code and wait for a signer app to answer it.
  useEffect(() => {
    QRCode.toDataURL(uri, { margin: 1, width: 480, color: { dark: '#1e1442', light: '#ffffff' } }).then(setQr)
    const abort = new AbortController()
    // The wait ends whenever every relay drops the subscription (a relay is down or
    // flaky). The QR code stays valid, so keep listening again instead of failing.
    const listen = async () => {
      for (let failures = 1; !abort.signal.aborted; failures++) {
        try {
          await Promise.any(NIP46_RELAYS.map((r) => pool.ensureRelay(r, { connectionTimeout: 8000 })))
          if (abort.signal.aborted) return
          const login = loginNostrConnect(clientSecret, uri, abort.signal)
          setReady(true)
          await login
          return
        } catch {
          if (abort.signal.aborted) return
          setRelayTrouble(failures >= 3)
          await new Promise((r) => setTimeout(r, Math.min(1000 * failures, 5000)))
        }
      }
    }
    listen()
    return () => abort.abort()
  }, [clientSecret, uri, loginNostrConnect])

  const submitBunker = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await loginBunker(bunkerInput)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-display">Connect a signer app</h2>
      <p className="text-sm text-white/60">Scan with your signer app, or tap the button if the signer is on this phone.</p>
      <div className="mx-auto flex size-60 items-center justify-center overflow-hidden rounded-3xl bg-white p-3">
        {qr && ready ? <img src={qr} alt="Nostr Connect QR code" className="size-full" /> : <Spinner />}
      </div>
      <div className="flex items-center justify-center gap-2 text-sm text-white/50">
        <Spinner className="size-4" /> {ready ? 'Waiting for your signer…' : 'Connecting…'}
      </div>
      {relayTrouble && (
        <p className="-mt-2 text-center text-xs text-tangerine">Having trouble reaching the connection relays. Still trying…</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <a
          href={ready ? uri : undefined}
          aria-disabled={!ready}
          className="inline-flex aria-disabled:pointer-events-none aria-disabled:opacity-50 items-center justify-center rounded-2xl bg-night-700 px-5 py-3 font-semibold transition-colors hover:bg-night-600"
        >
          Open signer app
        </a>
        <CopyButton text={uri} label="Copy link" />
      </div>
      <div className="my-1 flex items-center gap-3 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/10" /> or paste a bunker link <span className="h-px flex-1 bg-white/10" />
      </div>
      <form onSubmit={submitBunker} className="flex flex-col gap-3">
        <Field
          label="Bunker URL or NIP-05"
          placeholder="bunker://… or you@nsec.app"
          value={bunkerInput}
          onChange={(e) => setBunkerInput(e.target.value)}
        />
        <Button type="submit" loading={busy} disabled={!bunkerInput.trim()}>
          Connect
        </Button>
      </form>
    </div>
  )
}

function NsecLogin() {
  const loginNsec = useSession((s) => s.loginNsec)
  const [nsec, setNsec] = useState('')
  const [remember, setRemember] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEncrypted = nsec.trim().startsWith('ncryptsec1')
  const needsConfirm = remember && !isEncrypted

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (needsConfirm && password !== confirm) return setError('Passwords do not match.')
    if (needsConfirm && password.length < 8) return setError('Use at least 8 characters.')
    setBusy(true)
    // NIP-49 key stretching blocks for a moment; let the spinner paint first.
    await new Promise((r) => setTimeout(r, 30))
    try {
      await loginNsec(nsec, { remember, password: remember || isEncrypted ? password : undefined })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="text-xl font-display">Log in with your private key</h2>
      <Warning>
        Your key never leaves this device. For better security, use an extension or signer app so this site never
        sees your key at all.
      </Warning>
      <Field
        label="Private key"
        type="password"
        autoComplete="off"
        placeholder="nsec1… or ncryptsec1…"
        value={nsec}
        onChange={(e) => setNsec(e.target.value)}
      />
      <Toggle checked={remember} onChange={setRemember} label="Remember me on this device" />
      {(remember || isEncrypted) && (
        <Field
          label={isEncrypted ? 'Key password' : 'Choose a password'}
          type="password"
          autoComplete={isEncrypted ? 'current-password' : 'new-password'}
          hint={isEncrypted ? undefined : 'Encrypts your key on this device (NIP-49). You will need it each time you open the app.'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      {needsConfirm && (
        <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <Button type="submit" loading={busy} disabled={!nsec.trim()}>
        Log in
      </Button>
    </form>
  )
}

function CreateAccount() {
  const { createAccount, loginNsec } = useSession()
  const [{ nsec }] = useState(createAccount)
  const [saved, setSaved] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return toast.error('Use at least 8 characters for your password.')
    setBusy(true)
    await new Promise((r) => setTimeout(r, 30))
    try {
      await loginNsec(nsec, { remember: true, password })
      toast.success('Welcome to Nostr! Set up your profile so friends recognize you.')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="text-xl font-display">Your new Nostr key 🎉</h2>
      <p className="text-sm text-white/60">
        This key <em>is</em> your account, in this game and in every other Nostr app. Nobody can reset it for you.
      </p>
      <div className="rounded-2xl border-2 border-dashed border-lemon/50 bg-night-950/60 p-4 font-mono text-sm break-all text-lemon">{nsec}</div>
      <CopyButton text={nsec} label="Copy private key" />
      <Warning>Save it in a password manager now. Never share your nsec with anyone, including friends.</Warning>
      <Toggle checked={saved} onChange={setSaved} label="I saved my private key somewhere safe" />
      <Field
        label="Device password"
        type="password"
        autoComplete="new-password"
        hint="Encrypts the key on this device (NIP-49)."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" loading={busy} disabled={!saved}>
        Let's play
      </Button>
    </form>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-tangerine/10 p-3 text-sm text-tangerine">
      <TriangleAlert className="size-5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="secondary"
      icon={copied ? <Check className="size-5 text-mint" /> : <Copy className="size-5" />}
      onClick={async () => {
        await copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied!' : label}
    </Button>
  )
}

// Generic party confetti: deliberately not pieces from any particular game.
const CONFETTI = [
  { shape: 'star', className: 'top-[8%] left-[8%] text-lemon size-14', delay: 0 },
  { shape: 'circle', className: 'top-[16%] right-[10%] text-mint size-10', delay: 1.2 },
  { shape: 'squiggle', className: 'bottom-[14%] left-[10%] text-bubblegum w-24 h-10', delay: 0.6 },
  { shape: 'triangle', className: 'bottom-[22%] right-[8%] text-tangerine size-12', delay: 1.8 },
  { shape: 'star', className: 'top-[46%] left-[4%] text-sky size-8', delay: 2.4 },
  { shape: 'squiggle', className: 'top-[34%] right-[4%] text-grape w-20 h-8', delay: 3 },
] as const

const SHAPES = {
  star: <path d="M50 6 L61 38 L95 38 L67 58 L78 92 L50 71 L22 92 L33 58 L5 38 L39 38 Z" fill="currentColor" />,
  circle: <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="14" />,
  triangle: <path d="M50 10 L92 86 L8 86 Z" fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="8" />,
  squiggle: <path d="M5 50 Q 17 15 30 50 T 55 50 T 80 50 T 105 50" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />,
}

function FloatingPieces() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden">
      {CONFETTI.map((c, i) => (
        <motion.svg
          key={i}
          viewBox={c.shape === 'squiggle' ? '0 0 110 100' : '0 0 100 100'}
          className={`absolute opacity-30 ${c.className}`}
          animate={{ y: [0, -24, 0], rotate: [0, 18, -10, 0] }}
          transition={{ duration: 6, repeat: Infinity, delay: c.delay, ease: 'easeInOut' }}
        >
          {SHAPES[c.shape]}
        </motion.svg>
      ))}
    </div>
  )
}
