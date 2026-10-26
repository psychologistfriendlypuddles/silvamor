import { useEffect, useState } from 'react'
import { BellRing, Server } from 'lucide-react'
import { DEFAULT_PUSH_URL, disablePush, enablePush, isPushEnabled, pushSupport, savePushServer, savedPushServer } from '../lib/push'
import { useSigner } from '../stores/session'
import { toast } from '../stores/toast'
import { Button, Card, Field, Toggle } from './ui'

/** "Notify me when Silvamor is closed": push notifications through a push service. */
export function PushCard() {
  const { signer, pubkey } = useSigner()
  const [support] = useState(pushSupport)
  const [server, setServer] = useState(() => savedPushServer(pubkey))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(server)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    isPushEnabled(pubkey).then(setEnabled, () => setEnabled(false))
  }, [pubkey])

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      if (on) {
        await enablePush(pubkey, server, signer)
        toast.success("Push notifications on. You'll hear about your games even when Silvamor is closed.")
      } else {
        await disablePush(pubkey, server, signer)
      }
      setEnabled(on)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const saveServer = async () => {
    const next = draft.trim().replace(/\/$/, '')
    if (next && !/^https?:\/\//.test(next)) return toast.error('Push servers look like https://push.example.com')
    // Move an active subscription to the new server.
    if (enabled) await disablePush(pubkey, server, signer).catch(() => {})
    savePushServer(pubkey, next)
    setServer(next)
    setEnabled(false)
    setEditing(false)
  }

  return (
    <Card className="mb-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-lemon" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">When Silvamor is closed</p>
          <p className="text-sm text-white/55">Get a push notification on this device for your turn, invites, strikes and more.</p>
        </div>
      </div>

      {support === 'insecure' ? (
        <p className="rounded-2xl bg-white/5 p-3 text-sm text-white/60">
          Push notifications need Silvamor opened from an HTTPS address (and, on iPhones, installed to the home screen).
          This page is on plain http, which is fine for testing, so they'll be available once Silvamor is deployed.
        </p>
      ) : support === 'unsupported' ? (
        <p className="rounded-2xl bg-white/5 p-3 text-sm text-white/60">
          This browser doesn't support push notifications. On iPhone, add Silvamor to your home screen and open it from there.
        </p>
      ) : (
        <>
          {server ? (
            <Toggle checked={enabled} onChange={(on) => !busy && toggle(on)} label={busy ? 'Working…' : 'Notify me when Silvamor is closed'} />
          ) : (
            <p className="text-sm text-tangerine">No push server is set up yet. Add one below.</p>
          )}
          {editing ? (
            <div className="flex items-end gap-2">
              <Field
                className="flex-1"
                label="Push server"
                placeholder={DEFAULT_PUSH_URL || 'https://push.example.com'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button variant="secondary" className="h-[52px]" onClick={saveServer}>
                Save
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraft(server)
                setEditing(true)
              }}
              className="flex items-center gap-1.5 self-start text-xs text-white/45 hover:text-white"
            >
              <Server className="size-3.5" />
              {server ? `Via ${server.replace(/^https?:\/\//, '')} · change` : 'Set a push server'}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
