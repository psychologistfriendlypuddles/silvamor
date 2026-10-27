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

/** Plays today's Daily Deal to the end, a card at a time; the app then publishes the run. */
async function playThrough(page: Page) {
  const hands = page.getByLabel('Hands', { exact: true })
  await expect(hands).toBeVisible({ timeout: 15_000 })
  for (let left = Number(await hands.textContent()); left > 0; left--) {
    await page.getByRole('group', { name: 'Your hand' }).getByRole('button').first().click()
    await page.getByRole('button', { name: 'Play hand' }).click()
  }
}

test('logging in with a signer app, and a hint while it waits for approval', async ({ page }) => {
  const signer = fakeSignerApp(3000)
  await seed(profileEvent(signer.userSk, 'Signer User'))

  await page.goto('/')
  await page.getByRole('button', { name: /Signer app/ }).click()
  const uri = await page.locator('a[href^="nostrconnect:"]').getAttribute('href')
  // The app asks for permission per event kind, so the signer can offer "always allow".
  expect(new URL(uri!).searchParams.get('perms')).toContain('sign_event:1952')
  await signer.approve(uri!)
  await expect(page.getByRole('link', { name: 'silvamor home' }).first()).toBeVisible({ timeout: 15_000 })

  // Publishing a finished run needs a signature: while the signer app hasn't answered, say so.
  await playThrough(page)
  await expect(page.getByText('Waiting for your signer app…')).toBeVisible()
  await expect(page.getByLabel('Final score')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('list', { name: 'Podium' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Waiting for your signer app…')).toBeHidden()
  expect(signer.requests).toContain('sign_event:1952')
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
