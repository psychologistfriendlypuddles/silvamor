import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Spinner } from '../../components/ui'
import { lastDays, UNREACHABLE_NOTE, useBoardRuns } from '../../hooks/useBoardRuns'
import type { Block } from '../../lib/bitcoin'
import { dayEndsLocally, dayStart, fetchDayBlock } from '../day'

const players = (n: number) => `${n.toLocaleString('en-US')} player${n === 1 ? '' : 's'}`

/**
 * Under the game's title: today's seed block and how many have played it (on Silvamor's relay),
 * when today's game ends on the player's clock, and the last 7 games in a popup.
 */
export function GameInfo({ day, block }: { day: string; block: Block }) {
  const runs = useBoardRuns([day], undefined, 60_000)
  const [open, setOpen] = useState(false)
  const count = Array.isArray(runs) ? new Set(runs.map((r) => r.author)).size : runs

  return (
    <div className="mb-5 flex flex-col items-center gap-1 text-center text-sm text-white/55">
      <p>
        Current block {block.height.toLocaleString('en-US')}
        {count === 'unreachable' ? " (couldn't reach Silvamor's relay to count its players)" : ` has ${count === null ? '…' : players(count)}`}
        <span className="mx-2 text-white/30" aria-hidden>
          •
        </span>
        <button onClick={() => setOpen(true)} className="text-grape underline-offset-2 hover:underline">
          View last 7 games
        </button>
      </p>
      <p className="text-xs text-white/40">Today's game ends at {dayEndsLocally()} your time (midnight UTC).</p>
      <Modal open={open} onClose={() => setOpen(false)}>
        {open && <LastGames onClose={() => setOpen(false)} />}
      </Modal>
    </div>
  )
}

/** The last 7 days' games: their seed blocks and players. Just the numbers, no replays. */
function LastGames({ onClose }: { onClose(): void }) {
  const days = useMemo(() => lastDays(7), [])
  const runs = useBoardRuns(days)
  const [blocks, setBlocks] = useState<Record<string, Block | null>>({})

  useEffect(() => {
    let cancelled = false
    for (const day of days) {
      fetchDayBlock(day)
        .then((b) => !cancelled && setBlocks((all) => ({ ...all, [day]: b })))
        .catch(() => !cancelled && setBlocks((all) => ({ ...all, [day]: null })))
    }
    return () => {
      cancelled = true
    }
  }, [days])

  const counts = useMemo(() => {
    const seen = new Map<string, Set<string>>()
    for (const r of Array.isArray(runs) ? runs : []) seen.set(r.day, (seen.get(r.day) ?? new Set()).add(r.author))
    return seen
  }, [runs])
  const starts = new Date(dayStart(days[0]) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl tracking-wide">The last 7 games</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white">
          <X className="size-5" />
        </button>
      </div>
      <p className="text-sm text-white/60">
        Each game runs from 00:00 UTC to 00:00 UTC the next day ({starts} your time). Its transactions come from the first Bitcoin block mined
        after 00:00 UTC. Players are everyone whose block reached Silvamor's relay.
      </p>
      <table className="w-full text-sm" aria-label="The last 7 games">
        <thead>
          <tr className="border-b border-white/10 text-left text-white/45">
            <th className="py-2 font-medium">UTC date</th>
            <th className="py-2 text-right font-medium">Seed block</th>
            <th className="py-2 text-right font-medium">Players</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day, i) => (
            <tr key={day} className={`border-b border-white/5 ${i === 0 ? 'text-grape' : 'text-white/80'}`}>
              <td className="py-2">
                {day}
                {i === 0 && <span className="ml-2 text-xs text-white/45">today</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{day in blocks ? (blocks[day]?.height.toLocaleString('en-US') ?? '–') : '…'}</td>
              <td className="py-2 text-right tabular-nums">{runs === null ? <Spinner className="ml-auto size-4" /> : runs === 'unreachable' ? '–' : (counts.get(day)?.size ?? 0).toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs === 'unreachable' && <p className="text-sm text-white/50">{UNREACHABLE_NOTE}</p>}
    </div>
  )
}
