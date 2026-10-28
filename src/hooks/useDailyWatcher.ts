import { useEffect, useState } from 'react'
import * as nip19 from 'nostr-tools/nip19'
import { pool } from '../lib/nostr/pool'
import { DAILY_RUN_KIND } from '../lib/nostr/dailyRuns'
import { beatenNotice, type Notice, type RunLookup } from '../lib/notifications'
import { noticeText } from '../lib/noticeText'
import { displayName } from '../lib/nostr/profile'
import { fetchDayBlock } from '../games/dailydeal/daily'
import { useSession } from '../stores/session'
import { useGroups } from '../stores/groups'
import { gameReadRelays } from '../stores/relays'
import { useNotifications } from '../stores/notifications'
import { useProfiles } from '../stores/profiles'
import { toast } from '../stores/toast'

/** Runs that beat yours stay worth hearing about for this long. */
const RECENT_SECONDS = 2 * 24 * 3600

/**
 * While the app is open, listens for Daily Deal runs that tag the user as beaten
 * (docs/PROTOCOL.md, "Daily Deal") and turns those that check out (`beatenNotice`)
 * into notifications: the Alerts page, its badge and a toast.
 */
export function useDailyWatcher() {
  const pubkey = useSession((s) => s.pubkey)
  const signer = useSession((s) => s.signer)
  const follows = useGroups((s) => s.follows)
  const loaded = useGroups((s) => s.loaded)
  const [mountedAt] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (pubkey) useNotifications.getState().load(pubkey)
  }, [pubkey])

  useEffect(() => {
    if (pubkey && signer && !loaded) useGroups.getState().load(signer, pubkey).catch(() => {})
  }, [pubkey, signer, loaded])

  const followsKey = loaded ? follows.join(',') : null
  useEffect(() => {
    if (!pubkey || !followsKey) return
    const followed = new Set(followsKey.split(','))
    const lookup: RunLookup = {
      follows: async (_, author) => followed.has(author),
      dayBlock: fetchDayBlock,
      runs: (authors, day) => pool.querySync(gameReadRelays(), { kinds: [DAILY_RUN_KIND], authors, '#l': [day] }, { maxWait: 4000 }),
    }
    const sub = pool.subscribe(
      gameReadRelays(),
      { kinds: [DAILY_RUN_KIND], '#p': [pubkey], since: Math.floor(Date.now() / 1000) - RECENT_SECONDS },
      {
        onevent: (e) => {
          if (!followed.has(e.pubkey)) return
          beatenNotice(e, pubkey, lookup)
            .then((notice) => {
              if (!notice || !useNotifications.getState().add(notice)) return
              // Toast only what happens while the app is open, not runs found on start-up.
              if (notice.at >= mountedAt - 60) void announce(notice)
            })
            .catch(() => {})
        },
      },
    )
    return () => sub.close()
  }, [pubkey, followsKey, mountedAt])
}

async function announce(notice: Notice) {
  await useProfiles.getState().fetch(notice.actor).catch(() => {})
  const name = displayName(useProfiles.getState().profiles[notice.actor]?.content, nip19.npubEncode(notice.actor))
  const { emoji, text } = noticeText(notice, name)
  toast.info(`${emoji} ${text}`, '/daily-deal')
}
