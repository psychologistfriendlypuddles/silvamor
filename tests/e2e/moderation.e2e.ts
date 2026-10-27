import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { expectNoErrors, followsEvent, goTo, login, newPlayer, onPodium, playerOnline, publishRun, publishSprite, seed } from './helpers'

test('featuring a sprite, and hiding its artist (until unhidden)', async ({ browser }) => {
  const name = `Weird bird ${Date.now() % 100000}`
  const alice = await playerOnline(browser, 'Alice')
  await publishSprite(alice, name)
  await publishRun(alice.sk)

  const bob = await onPodium(browser, 'Bob', [alice.pubkey])
  await expect(bob.page.getByRole('img', { name: new RegExp(`^${name} \\((win|happy)\\)$`) })).toBeVisible()
  await goTo(bob, '/sprites')
  await expect(bob.page.getByText(/No picks yet/)).toBeVisible()
  await bob.page.getByRole('button', { name: 'All', exact: true }).click()
  await bob.page.getByRole('button', { name, exact: true }).click()
  await bob.page.getByRole('button', { name: 'Feature this sprite' }).click()
  await expect(bob.page.getByText('Added to your picks ⭐')).toBeVisible()
  await bob.page.getByRole('button', { name: 'Close sprite', exact: true }).click()
  await bob.page.getByRole('button', { name: 'Featured', exact: true }).click()
  await expect(bob.page.getByRole('button', { name, exact: true })).toBeVisible()

  // Hiding Alice takes her sprites out of the shop, and off her on the podium for Bob.
  await bob.page.getByRole('button', { name, exact: true }).click()
  await bob.page.getByRole('button', { name: 'Hide artist' }).click()
  await expect(bob.page.getByText('Hid sprites by Alice')).toBeVisible()
  await expect(bob.page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await goTo(bob, '/')
  await expect(bob.page.getByRole('list', { name: 'Podium' }).getByRole('img', { name: /^Ostrich / })).toHaveCount(2)

  // Unhiding from the safety sheet brings them back.
  await goTo(bob, '/sprites')
  await bob.page.getByRole('button', { name: 'Shop safety' }).click()
  await bob.page.getByRole('button', { name: 'Unhide' }).click()
  await bob.page.getByRole('button', { name: 'Close safety' }).click()
  await goTo(bob, '/')
  await expect(bob.page.getByRole('img', { name: new RegExp(`^${name} \\((win|happy)\\)$`) })).toBeVisible()
  expectNoErrors(alice, bob)
})

test('three reports from people you follow blur a sprite, unless you turn that off', async ({ browser }) => {
  const name = `Rude bird ${Date.now() % 100000}`
  const alice = await playerOnline(browser, 'Alice')
  const id = await publishSprite(alice, name)
  await publishRun(alice.sk)
  const onAlice = new RegExp(`^${name} \\((win|happy)\\)$`)

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
  await seed(followsEvent(carol.sk, [alice.pubkey, ...reporters.map((sk) => getPublicKey(sk))]))
  await publishRun(carol.sk)
  await login(carol, '/sprites')
  await carol.page.getByRole('button', { name: 'All', exact: true }).click()
  const card = carol.page.getByRole('button', { name, exact: true })
  await expect(card.getByText('Reported')).toBeVisible()
  await goTo(carol, '/')
  await expect(carol.page.getByRole('list', { name: 'Podium' }).getByRole('img', { name: /^Ostrich / })).toHaveCount(2)

  // Dave follows only Alice: the same reports don't affect him.
  const dave = await onPodium(browser, 'Dave', [alice.pubkey])
  await expect(dave.page.getByRole('img', { name: onAlice })).toBeVisible()

  // Carol turns blurring off.
  await goTo(carol, '/sprites')
  await carol.page.getByRole('button', { name: 'Shop safety' }).click()
  await carol.page.getByLabel(/Blur reported sprites/).uncheck()
  await carol.page.getByRole('button', { name: 'Close safety' }).click()
  await goTo(carol, '/')
  await expect(carol.page.getByRole('img', { name: onAlice })).toBeVisible()
  expectNoErrors(alice, carol, dave)
})
