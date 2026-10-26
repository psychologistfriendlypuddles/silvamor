import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Smartphone } from 'lucide-react'
import { useSession } from '../stores/session'
import { useSignerActivity } from '../stores/signerActivity'

/**
 * Remote signers (NIP-46) get requests through a relay. When the signer app is on
 * the same phone it is usually paused in the background, so remind the user to
 * switch to it. Shown only once a request has been waiting a moment.
 */
/** After this long without an answer, offer a fresh connection. */
const OFFER_RECONNECT_MS = 20_000

export function SignerWaiting() {
  const { method, logout } = useSession()
  const pending = useSignerActivity((s) => s.pending)
  const [waitedLong, setWaitedLong] = useState(false)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    if (pending === 0) return
    const t = setTimeout(() => setWaitedLong(true), 1500)
    const s = setTimeout(() => setStuck(true), OFFER_RECONNECT_MS)
    return () => {
      clearTimeout(t)
      clearTimeout(s)
      setWaitedLong(false)
      setStuck(false)
    }
  }, [pending])

  const show = method === 'nip46' && pending > 0 && waitedLong
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          role="status"
          className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-mint/40 bg-night-900/95 p-4 shadow-2xl backdrop-blur md:bottom-6"
        >
          <motion.span animate={{ rotate: [0, -12, 12, 0] }} transition={{ duration: 1, repeat: Infinity, repeatDelay: 1 }}>
            <Smartphone className="size-6 shrink-0 text-mint" />
          </motion.span>
          <span className="text-sm">
            <span className="block font-semibold">Waiting for your signer app…</span>
            <span className="text-white/60">Switch to it to approve, then come back. If it's on this phone, it may need to be open to see the request.</span>
            {stuck && (
              <span className="mt-2 flex items-center gap-2">
                <span className="text-white/60">Not responding?</span>
                <button onClick={() => logout({ reconnectSigner: true })} className="rounded-lg bg-mint/20 px-2.5 py-1 font-semibold text-mint hover:bg-mint/30">
                  Reconnect
                </button>
              </span>
            )}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
