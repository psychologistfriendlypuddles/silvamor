import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { createGame, expectNoErrors, goTo, playerOnline, seed } from './helpers'

// The default build: wagers and honor badges switched off (FEATURES.wagers).

test('with wagers off: no wager option, rules or terms, and no honor badges', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { wallet: true })
  await alice.page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  await expect(alice.page.locator('form').getByText(/Time per turn/)).toBeVisible()
  await expect(alice.page.locator('form').getByLabel('Wager', { exact: true })).toHaveCount(0)
  await alice.page.locator('form').getByRole('button', { name: 'Create game' }).click()
  await expect(alice.page.getByText('Waiting for an opponent…')).toBeVisible()
  await expect(alice.page.getByRole('img', { name: /^(New|Red|Bronze|Silver|Gold) ·/ })).toHaveCount(0)

  await alice.page.getByRole('button', { name: 'Rules' }).click()
  await expect(alice.page.getByText(/Turn clock/)).toBeVisible()
  await expect(alice.page.getByText(/No wager on this game/)).toHaveCount(0)
  await alice.page.getByRole('button', { name: 'Close rules' }).click()

  await goTo(alice, '/terms')
  await expect(alice.page.getByRole('heading', { name: '4. no betting' })).toBeVisible()
  await expect(alice.page.getByText(/Friendly wagers/)).toHaveCount(0)
  await goTo(alice, '/profile')
  await expect(alice.page.getByText('Wager honor')).toHaveCount(0)
  expectNoErrors(alice)
})

test("with wagers off, other clients' wager games are neither listed nor joinable", async ({ browser }) => {
  // Another client publishes an open game with a wager.
  const sk = generateSecretKey()
  const host = getPublicKey(sk)
  const id = Math.random().toString(16).slice(2, 18).padEnd(16, '0')
  const title = `Betting table ${Date.now()}`
  await seed({
    sk,
    template: {
      kind: 30950,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({ title }),
      tags: [['d', id], ['t', 'silvamor'], ['game', 'tictactoe'], ['status', 'open'], ['access', 'open'], ['wager', '21']],
    },
  })
  // An ordinary game for comparison.
  const carol = await playerOnline(browser, 'Carol')
  const plainTitle = `Just for fun ${Date.now()}`
  await createGame(carol, { title: plainTitle })

  const bob = await playerOnline(browser, 'Bob')
  await expect(bob.page.getByRole('link', { name: new RegExp(plainTitle) })).toBeVisible()
  await expect(bob.page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0)

  await goTo(bob, `/game/${nip19.naddrEncode({ kind: 30950, pubkey: host, identifier: id })}`)
  await expect(bob.page.getByText(/set up with a wager, which Silvamor doesn't offer/)).toBeVisible()
  await expect(bob.page.getByRole('button', { name: 'Join game' })).toHaveCount(0)
  expectNoErrors(bob, carol)
})
