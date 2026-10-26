import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { createGame, expectNoErrors, followsEvent, goTo, login, newPlayer, playerOnline, publishSprite, seed } from './helpers'

test('featuring a sprite, and hiding its artist (until unhidden)', async ({ browser }) => {
  const name = `Weird bird ${Date.now() % 100000}`
  const alice = await playerOnline(browser, 'Alice')
  await publishSprite(alice, name)
  const path = await createGame(alice)

  const bob = await playerOnline(browser, 'Bob')
  await goTo(bob, '/sprites')
  await expect(bob.page.getByText(/No picks yet/)).toBeVisible()
  await bob.page.getByRole('button', { name: 'All', exact: true }).click()
  await bob.page.getByRole('button', { name, exact: true }).click()
  await bob.page.getByRole('button', { name: 'Feature this sprite' }).click()
  await expect(bob.page.getByText('Added to your picks ⭐')).toBeVisible()
  await bob.page.getByRole('button', { name: 'Close sprite', exact: true }).click()
  await bob.page.getByRole('button', { name: 'Featured', exact: true }).click()
  await expect(bob.page.getByRole('button', { name, exact: true })).toBeVisible()

  // Hiding Alice takes her sprites out of the shop, and off her in games for Bob.
  await bob.page.getByRole('button', { name, exact: true }).click()
  await bob.page.getByRole('button', { name: 'Hide artist' }).click()
  await expect(bob.page.getByText('Hid sprites by Alice')).toBeVisible()
  await expect(bob.page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await goTo(bob, path)
  await expect(bob.page.getByRole('img', { name: 'Ostrich (happy)' })).toBeVisible()

  // Unhiding from the safety sheet brings them back.
  await goTo(bob, '/sprites')
  await bob.page.getByRole('button', { name: 'Shop safety' }).click()
  await bob.page.getByRole('button', { name: 'Unhide' }).click()
  await bob.page.getByRole('button', { name: 'Close safety' }).click()
  await goTo(bob, path)
  await expect(bob.page.getByRole('img', { name: `${name} (happy)` })).toBeVisible()
  expectNoErrors(alice, bob)
})

test('three reports from people you follow blur a sprite, unless you turn that off', async ({ browser }) => {
  const name = `Rude bird ${Date.now() % 100000}`
  const alice = await playerOnline(browser, 'Alice')
  const id = await publishSprite(alice, name)
  const path = await createGame(alice)

  // Three people Carol follows report it (NIP-56); a fourth report from a stranger wouldn't count.
  const reporters = [generateSecretKey(), generateSecretKey(), generateSecretKey()]
  const now = Math.floor(Date.now() / 1000)
  await seed(
    ...reporters.map((sk) => ({
      sk,
      template: { kind: 1984, created_at: now, content: '', tags: [['p', alice.pubkey, 'profanity'], ['a', id, 'profanity'], ['k', '30951']] },
    })),
  )
  const carol = await newPlayer(browser, 'Carol')
  await seed(followsEvent(carol.sk, reporters.map((sk) => getPublicKey(sk))))
  await login(carol, '/sprites')
  await carol.page.getByRole('button', { name: 'All', exact: true }).click()
  const card = carol.page.getByRole('button', { name, exact: true })
  await expect(card.getByText('Reported')).toBeVisible()
  await goTo(carol, path)
  await expect(carol.page.getByRole('img', { name: 'Ostrich (happy)' })).toBeVisible()

  // Dave follows nobody: the same reports don't affect him.
  const dave = await playerOnline(browser, 'Dave', path)
  await expect(dave.page.getByRole('img', { name: `${name} (happy)` })).toBeVisible()

  // Carol turns blurring off.
  await goTo(carol, '/sprites')
  await carol.page.getByRole('button', { name: 'Shop safety' }).click()
  await carol.page.getByLabel(/Blur reported sprites/).uncheck()
  await carol.page.getByRole('button', { name: 'Close safety' }).click()
  await goTo(carol, path)
  await expect(carol.page.getByRole('img', { name: `${name} (happy)` })).toBeVisible()
  expectNoErrors(alice, carol, dave)
})
