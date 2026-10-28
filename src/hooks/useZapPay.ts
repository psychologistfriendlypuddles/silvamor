import { useState } from 'react'
import { buildZapRequest, fetchLnurlPay, requestPlainInvoice, requestZapInvoice } from '../lib/zaps'
import { payInvoice, paymentMethods } from '../lib/payments'
import { gameWriteRelays } from '../stores/relays'
import { useProfile } from '../stores/profiles'
import { useSigner } from '../stores/session'
import { toast } from '../stores/toast'
import { useDisplayName } from './useDisplayName'

export type PayMethod = 'nwc' | 'webln' | 'qr'

/**
 * Paying someone with a zap, about an addressable event (a sprite) or not (a tip to a player):
 * fetches an invoice from their Lightning address, then pays it with a connected
 * wallet, a browser wallet, or shows it as a QR code.
 */
export function useZapPay(f: { recipient: string; sats: number; coordinate?: string; content: string; onPaying?(): void; successText: string }) {
  const { signer } = useSigner()
  const lud16 = useProfile(f.recipient)?.lud16
  const name = useDisplayName(f.recipient)

  return useInvoicePay(async () => {
    if (!lud16) throw new Error(`${name} has no Lightning address on their profile.`)
    const lnurl = await fetchLnurlPay(lud16)
    const request = await signer.signEvent(buildZapRequest({ recipient: f.recipient, sats: f.sats, relays: gameWriteRelays(), coordinate: f.coordinate, content: f.content }))
    return requestZapInvoice(lnurl, request, f.sats)
  }, f)
}

/** Paying a Lightning address plainly, not as a zap: nothing is published (buying Silvamor a coffee). */
export function useLightningPay(f: { address: string; sats: number; comment: string; successText: string }) {
  return useInvoicePay(async () => requestPlainInvoice(await fetchLnurlPay(f.address), f.sats, f.comment), f)
}

/** Fetches the invoice once, then pays it with the chosen method or shows it. */
function useInvoicePay(getInvoice: () => Promise<string>, f: { onPaying?(): void; successText: string }) {
  const { pubkey } = useSigner()
  const [invoice, setInvoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pay = async (method: PayMethod) => {
    setBusy(true)
    try {
      const pr = invoice ?? (await getInvoice())
      setInvoice(pr)
      if (method === 'qr') return
      f.onPaying?.()
      await payInvoice(pubkey, pr, method)
      toast.success(f.successText)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return { pay, invoice, busy, methods: paymentMethods(pubkey) }
}
