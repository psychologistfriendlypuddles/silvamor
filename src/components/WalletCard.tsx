import { useState } from 'react'
import { Unplug, Wallet } from 'lucide-react'
import { hasNwc, isNwcConnection, removeNwc, saveNwc } from '../lib/payments'
import { useSigner } from '../stores/session'
import { toast } from '../stores/toast'
import { Button, Card, Field } from './ui'

/** Connect a wallet (Nostr Wallet Connect) so tips can be paid with one tap. */
export function WalletCard({ pubkey }: { pubkey: string }) {
  const { signer } = useSigner()
  const [connected, setConnected] = useState(() => hasNwc(pubkey))
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const error = link && !isNwcConnection(link) ? 'Paste a nostr+walletconnect://… link from your wallet' : null

  const connect = async () => {
    setBusy(true)
    try {
      await saveNwc(signer, pubkey, link)
      setConnected(true)
      setLink('')
      toast.success('Wallet connected ⚡')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Wallet className="size-5 text-lemon" />
        <p className="font-semibold">Wallet</p>
      </div>
      {connected ? (
        <>
          <p className="text-sm text-white/55">
            A wallet is connected on this device (Nostr Wallet Connect). Tips can be paid with one tap.
          </p>
          <Button
            variant="secondary"
            icon={<Unplug className="size-4" />}
            className="self-start"
            onClick={() => {
              removeNwc(signer, pubkey)
              setConnected(false)
            }}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-white/55">
            Optional. Paste a Nostr Wallet Connect link from your wallet (Alby Hub, Primal, Coinos, …) to pay{' '}
            tips with one tap. Give it a small budget: the link stays on this device, encrypted to your
            key, but can spend up to that budget. Without one you can still pay by QR code.
          </p>
          <Field label="Connection link" placeholder="nostr+walletconnect://…" value={link} onChange={(e) => setLink(e.target.value)} error={error} />
          <Button variant="lemon" disabled={!link || !!error} loading={busy} className="self-start" onClick={connect}>
            Connect wallet
          </Button>
        </>
      )}
    </Card>
  )
}
