import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import * as nip19 from 'nostr-tools/nip19'
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { MAX_CARDS, dailyDealRules, scorePlay, type DailyDealMove, type DailyDealState } from '../../src/games/dailydeal/rules'

export const RELAY = 'ws://localhost:7777'


export interface Player {
  name: string
  sk: Uint8Array
  pubkey: string
  page: Page
  /** Page errors and console errors (including CSP violations) seen so far. */
  errors: string[]
}

/** Publishes events straight to the test relay, e.g. to seed profiles or follows. */
export async function seed(...events: { sk: Uint8Array; template: EventTemplate }[]) {
  const relay = await Relay.connect(RELAY)
  for (const { sk, template } of events) await relay.publish(finalizeEvent(template, sk))
  relay.close()
}

const nowSec = () => Math.floor(Date.now() / 1000)

/** A Lightning address on the test relay's pretend Lightning provider. */
export const lightningAddress = (name: string) => `${name.toLowerCase()}@localhost:7777`

export function profileEvent(sk: Uint8Array, name: string, lud16?: string) {
  return { sk, template: { kind: 0, created_at: nowSec(), tags: [], content: JSON.stringify({ name, lud16 }) } }
}

export function followsEvent(sk: Uint8Array, pubkeys: string[]) {
  return { sk, template: { kind: 3, created_at: nowSec(), tags: pubkeys.map((p) => ['p', p]), content: '' } }
}

export interface PlayerOptions {
  /** true, or how many ms ahead of real time the player's clock starts. */
  fakeClock?: boolean | number
  touch?: boolean
  /** A zappable Lightning address, and a browser wallet (WebLN) paying through the test relay. */
  wallet?: boolean
}

/**
 * A fresh browser context with its own key and profile, not yet logged in.
 * `fakeClock` lets a test fast-forward time (e.g. turn clocks) instead of waiting.
 */
// Players' pages from earlier tests would keep polling the shared test relay and slow
// later tests down, so they're closed when the next test makes its first player.
let openContexts: { testId: string; context: BrowserContext }[] = []

export async function newPlayer(browser: Browser, name: string, opts: PlayerOptions = {}): Promise<Player> {
  const testId = test.info().testId
  await Promise.all(openContexts.filter((c) => c.testId !== testId).map((c) => c.context.close().catch(() => {})))
  openContexts = openContexts.filter((c) => c.testId === testId)
  const sk = generateSecretKey()
  await seed(profileEvent(sk, name, opts.wallet ? lightningAddress(name) : undefined))
  // `touch` makes a phone: touch input (taps report pointerType "touch").
  const context = await browser.newContext(opts.touch ? { hasTouch: true, isMobile: true } : {})
  openContexts.push({ testId, context })
  if (opts.fakeClock) await context.clock.install(typeof opts.fakeClock === 'number' ? { time: Date.now() + opts.fakeClock } : undefined)
  if (opts.wallet) {
    await context.addInitScript(() => {
      ;(window as unknown as { webln: unknown }).webln = {
        enable: async () => {},
        sendPayment: async (invoice: string) => {
          const res = await fetch(`http://localhost:7777/lnurlp/pay?invoice=${invoice}`, { method: 'POST' })
          if (!res.ok) throw new Error('payment failed')
          return res.json()
        },
      }
    })
  }
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  return { name, sk, pubkey: getPublicKey(sk), page, errors }
}

export async function login(player: Player, path = '/') {
  const { page } = player
  await page.goto(path)
  await page.getByRole('button', { name: /Private key/ }).click()
  await page.getByPlaceholder(/nsec1/).fill(nip19.nsecEncode(player.sk))
  await page.getByRole('switch').click() // don't remember: no device password needed
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  // Logged in once the app shell (with the logo link home) replaces the login form.
  await expect(page.getByRole('link', { name: 'silvamor home' }).first()).toBeVisible({ timeout: 15_000 })
}

export async function playerOnline(browser: Browser, name: string, path = '/', opts: PlayerOptions = {}) {
  const player = await newPlayer(browser, name, opts)
  await login(player, path)
  return player
}

/** Moves within the single-page app, keeping the in-memory session. */
export async function goTo(player: Player, path: string) {
  await player.page.evaluate((p) => {
    history.pushState({}, '', p)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

// --- Daily Deal, worked out here the way the protocol says (docs/PROTOCOL.md, "Daily Deal") ---

export const today = () => new Date().toISOString().slice(0, 10)

/** The test relay's first block at or after 00:00 UTC today: the day's seed block. */
export async function dayBlock() {
  const midnight = Date.parse(`${today()}T00:00:00Z`) / 1000
  const blocks: { id: string; height: number; timestamp: number }[] = []
  for (let h = Number(await (await fetch('http://localhost:7777/api/blocks/tip/height')).text()); h > 0; h -= 10) {
    const page: typeof blocks = await (await fetch(`http://localhost:7777/api/blocks/${h}`)).json()
    blocks.push(...page)
    if (page.every((b) => b.timestamp < midnight - 7200)) break
  }
  return blocks.filter((b) => b.timestamp >= midnight).sort((a, b) => a.height - b.height)[0]
}

/** Today's rules, as the app deals them. */
export async function todaysRules() {
  const block = await dayBlock()
  return { block, rules: dailyDealRules(createHash('sha256').update(`silvamor/dailydeal/${today()}/${block.id}`).digest('hex')) }
}

export type Strategy = (s: DailyDealState) => number[]
const byRank = (s: DailyDealState) => [...s.hand].sort((a, b) => (b % 13) - (a % 13) || Math.floor(a / 13) - Math.floor(b / 13))
const subsets = (cards: number[]): number[][] =>
  cards.flatMap((c, i) => [[c], ...subsets(cards.slice(i + 1)).filter((s) => s.length < MAX_CARDS).map((s) => [c, ...s])])
/** Ways to play each hand: the board's top five cards (as the UI tests pick them), the lowest card, and the best play. */
export const STRATEGIES: Record<'topFive' | 'lowest' | 'bottomFive' | 'highest' | 'best', Strategy> = {
  topFive: (s) => byRank(s).slice(0, 5),
  lowest: (s) => byRank(s).slice(-1),
  bottomFive: (s) => byRank(s).slice(-5),
  highest: (s) => byRank(s).slice(0, 1),
  best: (s) => subsets(s.hand).sort((a, b) => scorePlay(b, s.perks, s.handsLeft === 1).points - scorePlay(a, s.perks, s.handsLeft === 1).points)[0],
}

/** A whole run on today's deal, playing every hand with `choose`. */
export async function runWith(choose: Strategy) {
  const { block, rules } = await todaysRules()
  let state = rules.init()
  const moves: DailyDealMove[] = []
  while (!rules.outcome(state)) {
    const move = { play: choose(state) }
    state = rules.apply(state, move)
    moves.push(move)
  }
  return { block, moves, score: state.score }
}

/** Publishes a finished run for today, as the app would (kind 1952); returns its score. */
export async function publishRun(sk: Uint8Array, opts: { run?: Awaited<ReturnType<typeof runWith>>; beaten?: string[] } = {}) {
  const run = opts.run ?? (await runWith(STRATEGIES.lowest))
  await seed({
    sk,
    template: {
      kind: 1952,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({ moves: run.moves }),
      tags: [
        ['L', 'silvamor/dailydeal'],
        ['l', today(), 'silvamor/dailydeal'],
        ['block', String(run.block.height), run.block.id],
        ['score', String(run.score)],
        ...(opts.beaten ?? []).map((p) => ['p', p]),
      ],
    },
  })
  return run.score
}

/**
 * A player who follows `friends` and has already played today, logged in on the Daily Deal
 * page: their friends who played stand on the podium (with their sprites).
 */
export async function onPodium(browser: Browser, name: string, friends: string[], opts: PlayerOptions = {}) {
  const player = await newPlayer(browser, name, opts)
  await seed(followsEvent(player.sk, friends))
  await publishRun(player.sk)
  await login(player)
  await expect(player.page.getByRole('list', { name: 'Podium' })).toBeVisible()
  return player
}

export function expectNoErrors(...players: Player[]) {
  for (const p of players) expect(p.errors, `${p.name} had page errors`).toEqual([])
}

// --- Sprites ---

/** The ostrich sheet with junk after the PNG end: a "different" sheet each run, so it isn't taken for a copy. */
export const uniqueSheet = () => ({
  name: 'duck.png',
  mimeType: 'image/png',
  buffer: Buffer.concat([readFileSync(new URL('../../public/sprites/ostrich.png', import.meta.url)), randomBytes(16)]),
})
/** The address (30951:<artist>:<d>) of the artist's sprite with this title. */
export async function spriteIdByTitle(artist: string, title: string) {
  const relay = await Relay.connect(RELAY)
  const events = await new Promise<{ tags: string[][] }[]>((resolve) => {
    const found: { tags: string[][] }[] = []
    const sub = relay.subscribe([{ kinds: [30951], authors: [artist] }], {
      onevent: (e) => found.push(e),
      oneose: () => {
        sub.close()
        resolve(found)
      },
    })
  })
  relay.close()
  const e = events.find((e) => e.tags.some((t) => t[0] === 'title' && t[1] === title))!
  return `30951:${artist}:${e.tags.find((t) => t[0] === 'd')![1]}`
}

export const SPRITE_MANIFEST = JSON.stringify({ version: 1, size: 64, pixelated: true, animations: { idle: { row: 0, frames: 4, fps: 4 }, happy: { row: 2, frames: 4, fps: 8 } } })

/** The player publishes (and starts using) a sprite from the shop; returns its address. */
export async function publishSprite(player: Player, name: string) {
  const { page } = player
  await goTo(player, '/sprites')
  await page.getByRole('button', { name: 'Share a sprite' }).click()
  await page.getByPlaceholder('Disco duck').fill(name)
  await page.getByLabel('Sprite sheet').setInputFiles(uniqueSheet())
  await page.getByLabel('Manifest').fill(SPRITE_MANIFEST)
  await page.getByRole('button', { name: 'Publish and use it' }).click()
  await expect(page.getByText(`${name} is now your sprite ✨`)).toBeVisible()
  await page.getByRole('button', { name: 'Close sprite', exact: true }).click()
  return spriteIdByTitle(player.pubkey, name)
}
