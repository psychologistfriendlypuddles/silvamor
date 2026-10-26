import { create } from 'zustand'

/** Requests waiting on a remote signer app (NIP-46), so the UI can tell the user to go approve them. */
export const useSignerActivity = create<{ pending: number }>(() => ({ pending: 0 }))

/**
 * Give up on a signer request after this long. Without a limit a lost request
 * (signer paused in the background, page reloaded meanwhile, connection removed
 * in the signer app) would leave the app waiting forever.
 */
export const SIGNER_TIMEOUT_MS = 60_000

export async function trackSignerRequest<T>(request: Promise<T>): Promise<T> {
  useSignerActivity.setState((s) => ({ pending: s.pending + 1 }))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Your signer app didn't answer. Open it and try again; if it keeps happening, tap Reconnect while waiting.")),
          SIGNER_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
    useSignerActivity.setState((s) => ({ pending: Math.max(0, s.pending - 1) }))
  }
}
