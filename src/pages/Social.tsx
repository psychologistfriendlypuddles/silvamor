import { useEffect, useMemo, useState } from 'react'
import type { Event } from 'nostr-tools/pure'
import { Card, PageTitle, Spinner, Switch } from '../components/ui'
import { Avatar } from '../components/Avatar'
import { PodiumBoard, type Ranked } from '../components/DayGame'
import { PlayerSheet } from '../components/PlayerSheet'
import { useSigner } from '../stores/session'
import { useGroups } from '../stores/groups'
import { readRelays, useRelays } from '../stores/relays'
import { useLoadGroups } from '../hooks/useLoadGroups'
import { useDisplayName } from '../hooks/useDisplayName'
import { DEFAULT_RELAYS, pool } from '../lib/nostr/pool'
import { feeTotals, lastDays, useBoardRuns, WINDOWS, type Window } from '../hooks/useBoardRuns'
import { GAME_TAG, sats } from '../games/miner/share'

type Tab = 'feed' | 'scores' | 'streaks'
const TABS: { id: Tab; title: string }[] = [
  { id: 'feed', title: 'Feed' },
  { id: 'scores', title: 'Top Scores' },
  { id: 'streaks', title: 'Top Streaks' },
]

/** Posts about the game, and the global boards: everyone who plays, ranked. */
export function SocialPage() {
  const [tab, setTab] = useState<Tab>('feed')
  return (
    <div>
      <PageTitle emoji="💬" title="Social" subtitle={`What players post about the game (#${GAME_TAG}), and the best miners on Silvamor.`} />
      <Switch<Tab> options={TABS} value={tab} onChange={setTab} label="Social" />
      <div className="mt-4">
        {tab === 'feed' && <Feed />}
        {tab === 'scores' && <TopScores />}
        {tab === 'streaks' && <TopStreaks />}
      </div>
    </div>
  )
}

// --- Feed: notes tagged with the game's hashtag ---

/** Notes live on the player's own relays and the big public ones (Silvamor's relay doesn't keep them). */
const feedRelays = () => [...new Set([...readRelays(useRelays.getState().relays), ...DEFAULT_RELAYS])]

function Feed() {
  const [who, setWho] = useState<'global' | 'follows'>('global')
  useLoadGroups()
  const follows = useGroups((s) => s.follows)
  const loaded = useGroups((s) => s.loaded)
  const authors = who === 'follows' ? follows : null
  const authorsKey = authors ? [...authors].sort().join(',') : '*'
  const [notes, setNotes] = useState<{ key: string; list: Event[]; done: boolean }>({ key: '', list: [], done: false })
  const [viewing, setViewing] = useState<string | null>(null)

  useEffect(() => {
    if (who === 'follows' && (!loaded || authorsKey === '')) return
    const list = authorsKey === '*' ? null : authorsKey.split(',')
    const seen = new Map<string, Event>()
    const show = (done: boolean) => setNotes({ key: authorsKey, list: [...seen.values()].sort((a, b) => b.created_at - a.created_at).slice(0, 100), done })
    const filters = list
      ? Array.from({ length: Math.ceil(list.length / 500) }, (_, i) => ({ kinds: [1], '#t': [GAME_TAG], authors: list.slice(i * 500, i * 500 + 500), limit: 100 }))
      : [{ kinds: [1], '#t': [GAME_TAG], limit: 100 }]
    let pending = filters.length
    const subs = filters.map((f) =>
      pool.subscribe(feedRelays(), f, {
        onevent: (e) => {
          seen.set(e.id, e)
          show(pending <= 0)
        },
        oneose: () => {
          pending--
          show(pending <= 0)
        },
      }),
    )
    const fallback = setTimeout(() => show(true), 6000)
    return () => {
      clearTimeout(fallback)
      subs.forEach((s) => s.close())
    }
  }, [who, authorsKey, loaded])

  const current = notes.key === authorsKey ? notes : { list: [], done: false }
  return (
    <div className="flex flex-col gap-3">
      <Switch<'global' | 'follows'>
        options={[
          { id: 'global', title: 'Global' },
          { id: 'follows', title: 'My follows' },
        ]}
        value={who}
        onChange={setWho}
        label="Whose posts"
      />
      {who === 'follows' && loaded && follows.length === 0 ? (
        <Card className="py-8 text-center text-sm text-white/50">You don't follow anyone yet.</Card>
      ) : current.list.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-8 text-center text-sm text-white/50">
          {current.done ? `No posts yet. Share your next block to start the feed with #${GAME_TAG}.` : <Spinner />}
        </Card>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Posts">
          {current.list.map((e) => (
            <Post key={e.id} event={e} onOpen={setViewing} />
          ))}
        </ol>
      )}
      <PlayerSheet pubkey={viewing} tipping onClose={() => setViewing(null)} />
    </div>
  )
}

const ago = (at: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - at)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function Post({ event, onOpen }: { event: Event; onOpen(pubkey: string): void }) {
  const name = useDisplayName(event.pubkey)
  return (
    <li>
      <Card className="flex gap-3 p-4">
        <button onClick={() => onOpen(event.pubkey)} aria-label={name} className="shrink-0 self-start">
          <Avatar pubkey={event.pubkey} className="size-10 text-sm" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 text-sm">
            <button onClick={() => onOpen(event.pubkey)} className="truncate font-semibold hover:underline">
              {name}
            </button>
            <span className="shrink-0 text-xs text-white/40">{ago(event.created_at)}</span>
          </p>
          <p className="mt-1 text-sm break-words whitespace-pre-wrap text-white/80">{event.content}</p>
        </div>
      </Card>
    </li>
  )
}

// --- The global boards, from Silvamor's relay ---

function TopScores() {
  const { pubkey } = useSigner()
  const [span, setSpan] = useState<Window>('1')
  const days = useMemo(() => lastDays(Number(span)), [span])
  const runs = useBoardRuns(days)
  const today = days[0]

  const rows = useMemo(
    (): Ranked[] =>
      feeTotals(runs ?? [])
        .slice(0, 50)
        .map((t) => ({ author: t.author, value: sats(t.fees) })),
    [runs],
  )
  // Today's scores are a target, so they stay hidden until you've played (as on the game page).
  const playedToday = (runs ?? []).some((r) => r.author === pubkey && r.day === today)

  return (
    <Card className="flex flex-col gap-3">
      <Switch<Window> options={[...WINDOWS]} value={span} onChange={setSpan} label="Time window" />
      <p className="text-xs text-white/45">
        {span === '1' ? 'The most fees in one block today, by everyone on Silvamor.' : `Fees from each player's blocks over the last ${span} days, added up.`}
      </p>
      {runs === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : span === '1' && !playedToday ? (
        <p className="py-6 text-center text-sm text-white/50">Mine today's block to see today's top scores.</p>
      ) : (
        <PodiumBoard rows={rows} me={pubkey} empty="Nobody has played yet." />
      )}
    </Card>
  )
}

function TopStreaks() {
  const { pubkey } = useSigner()
  const days = useMemo(() => lastDays(2), [])
  const runs = useBoardRuns(days)

  const rows = useMemo((): Ranked[] => {
    // A streak is alive if it reached today, or yesterday (today's block can still extend it).
    const best = new Map<string, { days: number; at: number }>()
    for (const run of runs ?? []) {
      const other = best.get(run.author)
      if (!other || run.streak > other.days || (run.streak === other.days && run.createdAt < other.at)) best.set(run.author, { days: run.streak, at: run.createdAt })
    }
    return [...best]
      .sort(([, a], [, b]) => b.days - a.days || a.at - b.at)
      .slice(0, 50)
      .map(([author, s]) => ({ author, value: `🔥 ${s.days} day${s.days === 1 ? '' : 's'}` }))
  }, [runs])

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-xs text-white/45">Days in a row played, by everyone on Silvamor. A streak still counts until today ends, so play today to keep yours.</p>
      {runs === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <PodiumBoard rows={rows} me={pubkey} empty="No streaks yet." />
      )}
    </Card>
  )
}
