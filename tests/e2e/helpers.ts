import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import * as nip19 from 'nostr-tools/nip19'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

export const RELAY = 'ws://localhost:7777'

/** The test build with wagers switched on (see playwright.config.ts); the default build has them off. */
export const WAGERS_URL = 'http://localhost:4175'

/** "Mines" blocks on the test relay's fake Bitcoin block-height source; returns the new height. */
export async function mine(blocks = 1): Promise<number> {
  const res = await fetch(`http://localhost:7777/mine?blocks=${blocks}`, { method: 'POST' })
  return Number(await res.text())
}

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

export interface GameOptions {
  game?: 'Tic-Tac-Toe' | 'Four-in-a-Row' | 'Dots and Boxes' | 'Chess' | 'Reversi' | 'Checkers' | 'Go' | 'Gomoku' | "Nine Men's Morris"
  /** Dots and boxes board size, e.g. '8×8'. */
  size?: string
  /** Shown in the lobby; tests use unique names because the relay outlives each test. */
  title?: string
  access?: 'Anyone' | 'Invite link' | 'Invite only' | 'Group'
  timer?: '1 block' | '3 blocks' | '6 blocks' | '144 blocks' | '432 blocks' | 'None'
  group?: string
  /** Wager in sats (the player needs `wallet`). */
  wager?: number
}

/** Host creates a tic-tac-toe game; returns its path (/game/naddr…). */
export async function createGame(host: Player, opts: GameOptions = {}) {
  const { page } = host
  await goTo(host, '/')
  await page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  const form = page.locator('form')
  if (opts.game) await form.getByRole('button', { name: new RegExp(`${opts.game}$`) }).click()
  if (opts.size) await form.getByRole('button', { name: opts.size, exact: true }).click()
  if (opts.title) await form.getByPlaceholder('Friday night showdown').fill(opts.title)
  if (opts.access) await form.getByRole('button', { name: opts.access, exact: true }).click()
  if (opts.group) await form.getByRole('button', { name: new RegExp(opts.group, 'i') }).click()
  if (opts.timer) await form.getByRole('button', { name: opts.timer, exact: true }).click()
  if (opts.wager) {
    await form.getByLabel('Wager', { exact: true }).check()
    await form.getByLabel('Wager in sats').fill(String(opts.wager))
    await form.getByLabel(/Wagering on games is legal where I live/).check()
  }
  await form.getByRole('button', { name: 'Create game' }).click()
  await expect(page.getByText('Waiting for an opponent…')).toBeVisible()
  return new URL(page.url()).pathname
}

export async function joinGame(player: Player) {
  await player.page.getByRole('button', { name: 'Join game' }).click()
}

/** Waits until the game has started for this player; returns true if it's their move. */
export async function waitForStart(player: Player) {
  const status = player.page.getByText(/^(Your turn!|Waiting for your opponent…)$/)
  await expect(status).toBeVisible()
  return (await status.textContent()) === 'Your turn!'
}

/** Waits for this player's turn, then presses a board button (e.g. "Square 5", "Column 3", "Line 21"). */
export async function playOn(player: Player, button: string) {
  await expect(player.page.getByText('Your turn!')).toBeVisible()
  await player.page.getByRole('button', { name: button, exact: true }).click()
}

/** Tic-tac-toe: plays a cell (0-8). */
export const play = (player: Player, cell: number) => playOn(player, `Square ${cell + 1}`)

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
