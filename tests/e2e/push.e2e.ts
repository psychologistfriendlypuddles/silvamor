import { expect, test } from '@playwright/test'
import { expectNoErrors, goTo, playerOnline } from './helpers'

const subscribers = async () => ((await (await fetch('http://localhost:8787/health')).json()) as { subscribers: number }).subscribers

test('turning push notifications on and off registers with the push service', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  // Headless Chromium can't reach a real browser push service, so stand in for the browser's
  // subscription; the app's request to our push service (NIP-98 signed) is real.
  await alice.page.addInitScript(() => {
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
  await alice.page.reload()
  // Reloading ends the in-memory session; log back in.
  const { login } = await import('./helpers')
  await login(alice)

  const before = await subscribers()
  await goTo(alice, '/notifications')
  await expect(alice.page.getByText('When Silvamor is closed', { exact: true })).toBeVisible()
  await expect(alice.page.getByText('Via localhost:8787')).toBeVisible()
  await alice.page.getByRole('switch').click()
  await expect(alice.page.getByText(/Push notifications on/)).toBeVisible()
  expect(await subscribers()).toBe(before + 1)

  await alice.page.getByRole('switch').click()
  await expect.poll(subscribers).toBe(before)
  expectNoErrors(alice)
})
