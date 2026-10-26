import { useEffect } from 'react'
import { motion } from 'motion/react'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { useRatings } from '../stores/ratings'
import { useVerifiedNip05 } from '../stores/profiles'
import { Card, Spinner } from './ui'

function useRecord(pubkey: string, fresh = false) {
  const entry = useRatings((s) => s.records[pubkey])
  const pending = useRatings((s) => s.pending[pubkey])
  useEffect(() => {
    useRatings.getState().fetch(pubkey, fresh)
  }, [pubkey, fresh])
  return { record: entry?.record, loading: !entry && pending !== false }
}

const percent = (r: number) => `${Math.round(r * 100)}%`

/** One-line summary for player cards. */
export function RecordLine({ pubkey }: { pubkey: string }) {
  const { record } = useRecord(pubkey)
  if (!record) return null
  if (record.opponents === 0) return <span className="text-white/40">New player</span>
  return (
    <span className="text-white/55">
      {record.wins}W {record.losses}L{record.draws ? ` ${record.draws}D` : ''} · {percent(record.reliability ?? 1)} reliable
    </span>
  )
}

/** ✓ with the verified NIP-05 identifier. */
export function VerifiedBadge({ pubkey, showName }: { pubkey: string; showName?: boolean }) {
  const nip05 = useVerifiedNip05(pubkey)
  if (!nip05) return null
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-mint" title={`Verified: ${nip05}`}>
      <BadgeCheck className="size-4 shrink-0" />
      {showName && <span className="truncate text-sm">{nip05}</span>}
    </span>
  )
}

export function RecordCard({ pubkey }: { pubkey: string }) {
  const { record, loading } = useRecord(pubkey, true)

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display">Record 🏅</h2>
        {record && <span className="text-sm text-white/45">{record.games} finished game{record.games === 1 ? '' : 's'}</span>}
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : !record || record.opponents === 0 ? (
        <p className="py-4 text-center text-sm text-white/50">No finished games yet. Go win some! ⚔️</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              ['Opponents', record.opponents, 'text-sky'],
              ['Wins', record.wins, 'text-mint'],
              ['Losses', record.losses, 'text-bubblegum'],
              ['Draws', record.draws, 'text-lemon'],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-2xl bg-night-950/60 py-3">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-white/50">{label}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="size-4 text-mint" /> Reliability
              </span>
              <span className="font-bold">{percent(record.reliability ?? 1)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-night-950/60">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-bubblegum via-lemon to-mint"
                initial={{ width: 0 }}
                animate={{ width: percent(record.reliability ?? 1) }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            {record.abandoned > 0 && (
              <p className="mt-1.5 text-xs text-tangerine">
                Ran out of time in {record.abandoned} game{record.abandoned === 1 ? '' : 's'}.
              </p>
            )}
          </div>
        </>
      )}
      <p className="text-xs text-white/40">
        Calculated by your app from games anyone can replay. Each opponent counts once (your overall head-to-head
        result), so replaying the same friend can't pump a record.
      </p>
    </Card>
  )
}
