import { useEffect } from 'react'
import { useSigner } from '../stores/session'
import { useGroups } from '../stores/groups'
import { toast } from '../stores/toast'

/** Loads the user's groups and follows once per session. */
export function useLoadGroups() {
  const { signer, pubkey } = useSigner()
  const loaded = useGroups((s) => s.loaded)
  useEffect(() => {
    if (!loaded) useGroups.getState().load(signer, pubkey).catch(toast.error)
  }, [loaded, signer, pubkey])
}
