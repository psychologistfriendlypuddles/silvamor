import { expect, test, type Browser } from '@playwright/test'
import { getToken } from 'nostr-tools/nip98'
import { finalizeEvent } from 'nostr-tools/pure'
import { expectNoErrors, goTo, login, newPlayer, publishRun, todaysDeal } from './helpers'
import { minerMoves } from '../../src/games/miner/rules'

const PUSH = 'http://localhost:8787'
const subscribers = async () => ((await (await fetch(`${PUSH}/health`)).json()) as { subscribers: number }).subscribers

/**
 * A player whose browser has a stand-in push subscription: headless Chromium can't reach a real
 * browser push service. The app's requests to our push service (NIP-98 signed) are real.
 */
async function withStandInPush(browser: Browser, name: string) {
  const player = await newPlayer(browser, name)
  await player.page.addInitScript(() => {
    let current: object | null = null
    const subscription = {
      endpoint: 'https://push.example/e2e-' + Math.random().toString(36).slice(2),
      toJSON() {
        return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'test-p256dh', auth: 'test-auth' } }
      },
      unsubscribe: async () => ((current = null), true),
    }
    const registration = { pushManager: { getSubscription: async () => current, subscribe: async () => (current = subscription) } }
    Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(registration) })
    navigator.serviceWorker.getRegistration = (async () => registration) as never
    Notification.requestPermission = async () => 'granted'
  })
  return player
}

test('streak reminders: on once you have played, registered with the push service, and off again', async ({ browser }) => {
  const { deal } = await todaysDeal()
  const alice = await withStandInPush(browser, 'Alice')
  await login(alice)
  const before = await subscribers()
  await goTo(alice, '/reminders')
  await expect(alice.page.getByText('Streak reminders', { exact: true })).toBeVisible()
  await expect(alice.page.getByText('Via localhost:8787')).toBeVisible()

  // Reminders are for keeping a streak: not before her first game.
  await alice.page.getByRole('switch').click()
  await expect(alice.page.getByText("Reminders are for keeping a streak, so play today's block first, then turn them on.")).toBeVisible()
  expect(await subscribers()).toBe(before)
  // The refusal is an HTTP error the browser logs; nothing else may go wrong.
  expect(alice.errors).toEqual([expect.stringContaining('status of 403')])
  alice.errors.length = 0

  await publishRun(alice.sk, { daysAgo: 1 })
  await alice.page.getByRole('switch').click()
  await expect(alice.page.getByText(/Streak reminders on/)).toBeVisible()
  expect(await subscribers()).toBe(before + 1)

  // A game while the service still has her: the app only asks, so she isn't asked to sign again.
  const calls: string[] = []
  alice.page.on('request', (r) => {
    if (r.url().startsWith(PUSH) && r.method() !== 'OPTIONS') calls.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  await goTo(alice, '/')
  for (const move of minerMoves(deal)) await alice.page.getByRole('button', { name: move === 'take' ? 'Take' : 'Pass' }).click()
  await expect(alice.page.getByRole('button', { name: 'Not now' })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => calls).toEqual(['POST /subscriptions/check'])

  await goTo(alice, '/reminders')
  await alice.page.getByRole('switch').click()
  await expect.poll(subscribers).toBe(before)
  // Turning them off was the only other call: nothing signed her up again after the game.
  expect(calls).toEqual(['POST /subscriptions/check', 'DELETE /subscriptions'])
  expectNoErrors(alice)
})

test('reminders the push service let go come back with the next game', async ({ browser }) => {
  const { deal } = await todaysDeal()
  const bob = await withStandInPush(browser, 'Bob')
  await publishRun(bob.sk, { daysAgo: 1 })
  await login(bob)
  const before = await subscribers()
  await goTo(bob, '/reminders')
  await bob.page.getByRole('switch').click()
  await expect(bob.page.getByText(/Streak reminders on/)).toBeVisible()
  expect(await subscribers()).toBe(before + 1)

  // The service lets him go, as after 30 days without a game, while this browser still has reminders on.
  const endpoint = await bob.page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())!.pushManager.getSubscription())!.endpoint)
  const url = `${PUSH}/subscriptions`
  const body = { endpoint }
  const authorization = await getToken(url, 'DELETE', (e) => finalizeEvent(e, bob.sk), true, body)
  expect((await fetch(url, { method: 'DELETE', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200)
  expect(await subscribers()).toBe(before)

  // His next game signs this browser up again.
  await goTo(bob, '/')
  for (const move of minerMoves(deal)) await bob.page.getByRole('button', { name: move === 'take' ? 'Take' : 'Pass' }).click()
  await expect(bob.page.getByRole('button', { name: 'Not now' })).toBeVisible({ timeout: 30_000 })
  await expect.poll(subscribers).toBe(before + 1)
  expectNoErrors(bob)
})
