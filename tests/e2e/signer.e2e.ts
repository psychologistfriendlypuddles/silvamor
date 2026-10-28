import { expect, test, type Page } from '@playwright/test'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { RELAY, profileEvent, seed } from './helpers'

/**
 * A stand-in for a signer app like Primal or Amber (NIP-46 over the test relay).
 * `delayMs` simulates the user taking a moment to switch apps and approve.
 */
function fakeSignerApp(delayMs: number, opts: { ignoreSigning?: boolean } = {}) {
  const userSk = generateSecretKey()
  const userPk = getPublicKey(userSk)
  const pool = new SimplePool()
  const conv = (pk: string) => nip44.getConversationKey(userSk, pk)
  const reply = (to: string, payload: object) =>
    Promise.allSettled(
      pool.publish(
        [RELAY],
        finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', to]], content: nip44.encrypt(JSON.stringify(payload), conv(to)) }, userSk),
      ),
    )
  const requests: string[] = []
  pool.subscribe([RELAY], { kinds: [24133], '#p': [userPk] }, {
    onevent: async (e) => {
      const req = JSON.parse(nip44.decrypt(e.content, conv(e.pubkey)))
      requests.push(req.method === 'sign_event' ? `sign_event:${JSON.parse(req.params[0]).kind}` : req.method)
      let result: string | null = null
      if (req.method === 'get_public_key') result = userPk
      else if (req.method === 'switch_relays') result = 'null'
      else if (req.method === 'sign_event') {
        if (opts.ignoreSigning) return // a request lost on the way: never answered
        await new Promise((r) => setTimeout(r, delayMs))
        result = JSON.stringify(finalizeEvent(JSON.parse(req.params[0]), userSk))
      }
      await reply(e.pubkey, { id: req.id, result })
    },
  })
  return {
    userSk,
    userPk,
    requests,
    /**
     * "Scans" the app's QR code and approves the connection. Scanning takes a person a moment;
     * the app starts listening for the answer just after showing the code.
     */
    approve: async (uri: string) => {
      await new Promise((r) => setTimeout(r, 1000))
      const u = new URL(uri)
      return reply(u.host || u.pathname.replace(/^\/+/, ''), { id: 'connect', result: u.searchParams.get('secret') })
    },
    close: () => pool.destroy(),
  }
}

/** Plays today's block to the end, taking what fits; the app then publishes the run. */
async function playThrough(page: Page) {
  const found = page.getByText(/^Block found after \d+ transactions$/)
  await expect(page.getByLabel('On offer')).toBeVisible({ timeout: 15_000 })
  while (!(await found.isVisible())) {
    const take = page.getByRole('button', { name: 'Take', exact: true })
    if (!(await take.isVisible())) {
      await page.waitForTimeout(50) // the next card is sliding in
      continue
    }
    await ((await take.isEnabled()) ? take : page.getByRole('button', { name: 'Pass', exact: true })).click()
  }
}

test('logging in with a signer app, and a hint while it waits for approval', async ({ page }) => {
  const signer = fakeSignerApp(3000)
  await seed(profileEvent(signer.userSk, 'Signer User'))

  await page.goto('/')
  await page.getByRole('button', { name: /Signer app/ }).click()
  const uri = await page.locator('a[href^="nostrconnect:"]').getAttribute('href')
  // The app asks for permission per event kind, so the signer can offer "always allow": for runs, not
  // for anything that would speak for the player elsewhere or read their messages.
  const perms = new URL(uri!).searchParams.get('perms')!.split(',')
  expect(perms).toContain('sign_event:1953')
  for (const risky of ['sign_event:0', 'sign_event:1', 'sign_event:5', 'sign_event:10002', 'sign_event:24242', 'nip44_decrypt']) expect(perms).not.toContain(risky)
  await signer.approve(uri!)
  await expect(page.getByRole('link', { name: 'silvamor home' }).first()).toBeVisible({ timeout: 15_000 })

  // Publishing a finished run needs a signature: while the signer app hasn't answered, say so.
  await playThrough(page)
  await expect(page.getByText('Waiting for your signer app…')).toBeVisible()
  await expect(page.getByLabel('Your fees')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('textbox', { name: 'Your note' })).toBeVisible({ timeout: 15_000 }) // offered once it's published
  await expect(page.getByText('Waiting for your signer app…')).toBeHidden()
  expect(signer.requests).toContain('sign_event:1953')
  signer.close()
})

test('a signer that never answers: Reconnect, reusing the same device connection', async ({ page }) => {
  const signer = fakeSignerApp(0, { ignoreSigning: true })
  await seed(profileEvent(signer.userSk, 'Signer User'))
  await page.clock.install()

  await page.goto('/')
  await page.getByRole('button', { name: /Signer app/ }).click()
  const firstUri = new URL((await page.locator('a[href^="nostrconnect:"]').getAttribute('href'))!)
  await signer.approve(firstUri.href)
  await expect(page.getByRole('link', { name: 'silvamor home' }).first()).toBeVisible({ timeout: 15_000 })

  await playThrough(page)
  await expect(page.getByText('Waiting for your signer app…')).toBeVisible()
  await page.clock.fastForward('00:21')
  await page.getByRole('button', { name: 'Reconnect' }).click()

  // Straight to the signer-app login, with the same app key for this device (no new "connected app").
  const secondUri = new URL((await page.locator('a[href^="nostrconnect:"]').getAttribute('href'))!)
  const appKey = (u: URL) => u.host || u.pathname.replace(/^\/+/, '')
  expect(appKey(secondUri)).toBe(appKey(firstUri))
  signer.close()
})
