import { useEffect, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { Lock } from 'lucide-react'
import * as nip19 from 'nostr-tools/nip19'
import { useSession } from '../stores/session'
import { useProfiles } from '../stores/profiles'
import { Avatar } from '../components/Avatar'
import { Button, Card, Field } from '../components/ui'

export function UnlockPage() {
  const { pubkey, unlock, logout } = useSession()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)

  useEffect(() => {
    if (pubkey) useProfiles.getState().fetch(pubkey)
  }, [pubkey])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    await new Promise((r) => setTimeout(r, 30))
    try {
      await unlock(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setShake((s) => s + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <motion.div key={shake} animate={shake ? { x: [0, -12, 12, -8, 8, 0] } : {}} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <Card initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <form onSubmit={submit} className="flex flex-col items-center gap-4 text-center">
            <div className="relative">
              {pubkey && <Avatar pubkey={pubkey} className="size-20" />}
              <span className="absolute -right-1 -bottom-1 rounded-full bg-grape p-1.5">
                <Lock className="size-4" />
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-display">Welcome back!</h1>
              {pubkey && <p className="font-mono text-xs text-white/40">{nip19.npubEncode(pubkey).slice(0, 20)}…</p>}
            </div>
            <Field
              className="w-full text-left"
              label="Device password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
            />
            <Button type="submit" className="w-full" loading={busy} disabled={!password}>
              Unlock
            </Button>
            <button type="button" onClick={() => logout()} className="text-sm text-white/50 hover:text-white">
              Use a different account
            </button>
          </form>
        </Card>
      </motion.div>
    </div>
  )
}
