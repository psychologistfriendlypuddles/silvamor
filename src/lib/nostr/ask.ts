import type { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'

/**
 * The events matching `filter` on `relay`, through `pool`, failing when the relay doesn't answer
 * within `maxWait` ms. `pool.querySync` resolves with nothing then, as if there were none. The app
 * (`queryOrFail`) and the push service both ask this way.
 */
export async function askRelay(pool: SimplePool, relay: string, filter: Filter, maxWait: number): Promise<Event[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let sub: { close(): void } | undefined
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${relay} didn't answer`)), maxWait)))
  try {
    const r = await Promise.race([pool.ensureRelay(relay, { connectionTimeout: maxWait }), timeout])
    return await Promise.race([
      new Promise<Event[]>((resolve, reject) => {
        const events: Event[] = []
        sub = r.subscribe([filter], {
          onevent: (e) => events.push(e),
          // Only the relay's own end of stored events: its timeout (by default the sub's) is ours instead.
          eoseTimeout: maxWait * 2,
          oneose: () => resolve(events),
          onclose: (reason) => reject(new Error(`${relay}: ${reason}`)),
        })
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
    sub?.close()
  }
}
