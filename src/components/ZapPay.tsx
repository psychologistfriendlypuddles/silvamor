import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Wallet, Zap } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { toast } from '../stores/toast'
import type { useZapPay } from '../hooks/useZapPay'
import { Button } from './ui'

/** The pay buttons for `useZapPay`, best method first, plus the invoice once there is one. */
export function PayButtons({ zap, label = 'Pay' }: { zap: ReturnType<typeof useZapPay>; label?: string }) {
  const { pay, invoice, busy, methods } = zap
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {methods.includes('nwc') && (
          <Button variant="lemon" loading={busy} icon={<Wallet className="size-5" />} onClick={() => pay('nwc')}>
            {label} with my wallet
          </Button>
        )}
        {methods.includes('webln') && (
          <Button variant={methods.includes('nwc') ? 'secondary' : 'lemon'} loading={busy} icon={<Zap className="size-5" />} onClick={() => pay('webln')}>
            {label} with browser wallet
          </Button>
        )}
        <Button variant={methods.length ? 'secondary' : 'lemon'} loading={busy && methods.length === 0} onClick={() => pay('qr')}>
          Show invoice
        </Button>
      </div>
      {invoice && <Invoice invoice={invoice} />}
    </>
  )
}

function Invoice({ invoice }: { invoice: string }) {
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(`lightning:${invoice}`, { margin: 1, width: 240 }).then(setQr, () => setQr(null))
  }, [invoice])
  return (
    <div className="flex flex-col items-center gap-2">
      {qr && (
        <a href={`lightning:${invoice}`} aria-label="Open in wallet">
          <img src={qr} alt="Lightning invoice QR code" className="size-48 rounded-xl bg-white p-1" />
        </a>
      )}
      <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => copyText(invoice).then(() => toast.success('Invoice copied'), toast.error)}>
        Copy invoice
      </Button>
    </div>
  )
}
