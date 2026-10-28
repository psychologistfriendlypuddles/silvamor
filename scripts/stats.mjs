// Silvamor stats from the relays: Block of the Day players per day, and each day's top fees.
// Usage: npm run stats                      (last 30 days)
//        npm run stats -- --days 7
//        npm run stats -- --json            (machine-readable)
//        npm run stats -- --relays wss://relay.damus.io,wss://nos.lol
//
// A player counts once a day: whoever published a run (kind 1953) labelled with that day.
// Scores are as claimed, not replayed (the app checks them; this is only a head count).
// Relays may drop old events, so this is reliable for recent weeks rather than all time.
import { fileURLToPath } from 'node:url'
import { SimplePool } from 'nostr-tools/pool'

// Every run goes to Silvamor's relay, whatever relays a player uses.
export const DEFAULT_RELAYS = ['wss://relay.silvamor.com']

const LABEL = 'silvamor/miner'
const day = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10)

/** Block of the Day players in the last `days` UTC days (today included), per day. */
export async function collectStats({ relays = DEFAULT_RELAYS, days = 30, now = Math.floor(Date.now() / 1000), maxWait = 8000 } = {}) {
  // Whole UTC days: from the start of the first day to now.
  const since = Math.floor(now / 86400) * 86400 - (days - 1) * 86400
  const dayList = []
  for (let t = since; t <= now; t += 86400) dayList.push(day(t))
  const pool = new SimplePool()
  try {
    const runs = await pool.querySync(relays, { kinds: [1953], '#l': dayList }, { maxWait })
    const perDay = dayList.map((d) => {
      const players = new Map() // pubkey -> their first run's score
      for (const e of runs.sort((a, b) => a.created_at - b.created_at)) {
        const label = e.tags.find((t) => t[0] === 'l' && t[2] === LABEL)?.[1]
        const score = Number(e.tags.find((t) => t[0] === 'score')?.[1])
        if (label === d && Number.isSafeInteger(score) && !players.has(e.pubkey)) players.set(e.pubkey, score)
      }
      return { day: d, players: players.size, topScore: Math.max(0, ...players.values()) }
    })
    const everyone = new Set(runs.map((e) => e.pubkey))
    return { days, from: day(since), to: day(now), players: everyone.size, perDay }
  } finally {
    pool.destroy()
  }
}

function print(stats) {
  const bar = (n, max) => '█'.repeat(max ? Math.round((n / max) * 30) : 0)
  console.log(`\nSilvamor Block of the Day, ${stats.from} to ${stats.to} (UTC)`)
  console.log(`${stats.players} different players\n`)
  console.log('Players per day (top fees, sats)')
  const max = Math.max(0, ...stats.perDay.map((d) => d.players))
  for (const d of stats.perDay) console.log(`  ${d.day}  ${String(d.players).padStart(5)}  ${String(d.topScore).padStart(7)}  ${bar(d.players, max)}`)
  console.log()
}

// Run directly: `node scripts/stats.mjs [--days N] [--json] [--relays a,b]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const value = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const days = Number(value('--days') ?? 30)
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    console.error('--days must be a whole number from 1 to 365')
    process.exit(1)
  }
  const relays = value('--relays')?.split(',').map((r) => r.trim()).filter(Boolean)
  const stats = await collectStats({ days, relays: relays?.length ? relays : undefined })
  if (args.includes('--json')) console.log(JSON.stringify(stats, null, 2))
  else print(stats)
  process.exit(0)
}
