// Silvamor game stats from the public relays: games started per day, and the most popular games.
// Usage: npm run stats                      (last 30 days)
//        npm run stats -- --days 7
//        npm run stats -- --json            (machine-readable)
//        npm run stats -- --relays wss://relay.damus.io,wss://nos.lol
//
// Only games that really started count: the listing (kind 30950) must point at a `start`
// action (kind 1951) signed by its host. Open, cancelled and made-up listings don't.
// Relays may drop old events, so this is reliable for recent weeks rather than all time.
import { fileURLToPath } from 'node:url'
import { SimplePool } from 'nostr-tools/pool'

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.silvamor.com']

const GAME_NAMES = {
  tictactoe: 'Tic-Tac-Toe',
  fourinarow: 'Four-in-a-Row',
  dotsandboxes: 'Dots and Boxes',
  chess: 'Chess',
  reversi: 'Reversi',
  checkers: 'Checkers',
  go: 'Go',
  gomoku: 'Gomoku',
  morris: "Nine Men's Morris",
}

const tag = (e, name) => e.tags.find((t) => t[0] === name)?.[1]
const day = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10)

/** Counts games started in the last `days` UTC days (today included): per day, and per game type. */
export async function collectStats({ relays = DEFAULT_RELAYS, days = 30, now = Math.floor(Date.now() / 1000), maxWait = 8000 } = {}) {
  // Whole UTC days: from the start of the first day to now.
  const since = Math.floor(now / 86400) * 86400 - (days - 1) * 86400
  const pool = new SimplePool()
  try {
    // Newest version of each listing touched in the window (a started game is updated after it starts).
    const listings = new Map()
    for (const e of await pool.querySync(relays, { kinds: [30950], '#t': ['silvamor'], since }, { maxWait })) {
      const key = `${e.pubkey}:${tag(e, 'd')}`
      if ((listings.get(key)?.created_at ?? 0) < e.created_at) listings.set(key, e)
    }
    const started = [...listings.values()].filter((l) => ['active', 'finished'].includes(tag(l, 'status')) && tag(l, 'e'))

    // Their start actions: proof the game began, and when.
    const ids = started.map((l) => tag(l, 'e'))
    const starts = new Map()
    for (let i = 0; i < ids.length; i += 200) {
      for (const e of await pool.querySync(relays, { kinds: [1951], ids: ids.slice(i, i + 200) }, { maxWait })) starts.set(e.id, e)
    }

    const games = []
    for (const l of started) {
      const start = starts.get(tag(l, 'e'))
      if (!start || start.pubkey !== l.pubkey || tag(start, 'a') !== `30950:${l.pubkey}:${tag(l, 'd')}`) continue
      let content
      try {
        content = JSON.parse(start.content)
      } catch {
        continue
      }
      if (content?.type !== 'start' || !Array.isArray(content.players) || content.players.length < 2) continue
      if (start.created_at < since || start.created_at > now) continue
      games.push({ game: tag(l, 'game'), day: day(start.created_at), finished: tag(l, 'status') === 'finished' })
    }

    const perDay = []
    for (let t = since; t <= now; t += 86400) {
      const d = day(t)
      perDay.push({ day: d, games: games.filter((g) => g.day === d).length })
    }
    const counts = new Map()
    for (const g of games) counts.set(g.game, (counts.get(g.game) ?? 0) + 1)
    const byGame = [...counts]
      .map(([game, n]) => ({ game, name: GAME_NAMES[game] ?? game, games: n }))
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))

    return { days, from: day(since), to: day(now), total: games.length, finished: games.filter((g) => g.finished).length, perDay, byGame }
  } finally {
    pool.destroy()
  }
}

function print(stats) {
  const bar = (n, max) => '█'.repeat(max ? Math.round((n / max) * 30) : 0)
  console.log(`\nSilvamor games started, ${stats.from} to ${stats.to} (UTC)`)
  console.log(`${stats.total} games (${stats.finished} finished)\n`)
  console.log('Most popular games')
  const maxGame = Math.max(0, ...stats.byGame.map((g) => g.games))
  for (const g of stats.byGame) console.log(`  ${g.name.padEnd(18)} ${String(g.games).padStart(5)}  ${bar(g.games, maxGame)}`)
  if (!stats.byGame.length) console.log('  (none yet)')
  console.log('\nGames per day')
  const maxDay = Math.max(0, ...stats.perDay.map((d) => d.games))
  for (const d of stats.perDay) console.log(`  ${d.day}  ${String(d.games).padStart(5)}  ${bar(d.games, maxDay)}`)
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
