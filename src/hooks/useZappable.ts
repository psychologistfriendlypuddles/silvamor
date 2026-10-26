import { useEffect, useState } from 'react'
import { zappable } from '../lib/wager'
import { useProfile, useProfiles } from '../stores/profiles'

/** Whether this player's Lightning address can receive zaps; undefined while checking. */
export function useZappable(pubkey: string) {
  const lud16 = useProfile(pubkey)?.lud16
  useEffect(() => {
    useProfiles.getState().fetch(pubkey)
  }, [pubkey])
  const [ok, setOk] = useState<{ lud16: string | undefined; ok: boolean }>()
  useEffect(() => {
    let live = true
    zappable(lud16).then((result) => live && setOk({ lud16, ok: result }))
    return () => {
      live = false
    }
  }, [lud16])
  return ok && ok.lud16 === lud16 ? ok.ok : undefined
}
