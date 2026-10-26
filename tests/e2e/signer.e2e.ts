import { expect, test } from '@playwright/test'
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
    /** "Scans" the app's QR code and approves the connection. */
    approve: (uri: string) => {
      const u = new URL(uri)
      return reply(u.host || u.pathname.replace(/^\/+/, ''), { id: 'connect', result: u.searchParams.get('secret') })
    },
    close: () => pool.destroy(),
  }
}

test('logging in with a signer app, and a hint while it waits for approval', async ({ page }) => {
  const signer = fakeSignerApp(3000)
  await seed(profileEvent(signer.userSk, 'Signer User'))

  await page.goto('/')
  await page.getByRole('button', { name: /Signer app/ }).click()
  const uri = await page.locator('a[href^="nostrconnect:"]').getAttribute('href')
  // The app asks for permission per event kind, so the signer can offer "always allow".
  expect(new URL(uri!).searchParams.get('perms')).toContain('sign_event:1951')
  await signer.approve(uri!)
  await expect(page.getByRole('link', { name: 'silvamor home' }).first()).toBeVisible({ timeout: 15_000 })

  // Creating a game needs a signature: while the signer app hasn't answered, say so.
  await page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  await page.locator('form').getByRole('button', { name: 'Create game' }).click()
  await expect(page.getByText('Waiting for your signer app…')).toBeVisible()
  await expect(page.getByText('Waiting for an opponent…')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Waiting for your signer app…')).toBeHidden()
  expect(signer.requests).toContain('sign_event:30950')
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

  await page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  await page.locator('form').getByRole('button', { name: 'Create game' }).click()
  await expect(page.getByText('Waiting for your signer app…')).toBeVisible()
  await page.clock.fastForward('00:21')
  await page.getByRole('button', { name: 'Reconnect' }).click()

  // Straight to the signer-app login, with the same app key for this device (no new "connected app").
  const secondUri = new URL((await page.locator('a[href^="nostrconnect:"]').getAttribute('href'))!)
  const appKey = (u: URL) => u.host || u.pathname.replace(/^\/+/, '')
  expect(appKey(secondUri)).toBe(appKey(firstUri))
  signer.close()
})
