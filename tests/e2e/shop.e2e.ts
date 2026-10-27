import { expect, test } from '@playwright/test'
import { expectNoErrors, goTo, onPodium, playerOnline, publishRun, publishSprite } from './helpers'

test('an artist shares a sprite; another player uses it for free and tips the artist', async ({ browser }) => {
  const name = `Disco duck ${Date.now() % 100000}`
  const alice = await playerOnline(browser, 'Alice', '/', { wallet: true })
  await publishSprite(alice, name)

  // Bob finds it and uses it: no payment needed.
  const bob = await playerOnline(browser, 'Bob', '/', { wallet: true })
  await goTo(bob, '/sprites')
  await bob.page.getByRole('button', { name: 'All', exact: true }).click()
  await bob.page.getByRole('button', { name, exact: true }).click()
  await bob.page.getByRole('button', { name: 'Use this sprite' }).click()
  await expect(bob.page.getByText(`${name} is now your sprite ✨`)).toBeVisible()

  // Tipping is optional, any of a few amounts.
  await bob.page.getByRole('button', { name, exact: true }).click()
  await expect(bob.page.getByText(/Totally optional: every sprite is free to use/)).toBeVisible()
  await bob.page.getByRole('button', { name: '⚡ 210 sats' }).click()
  await bob.page.getByRole('button', { name: 'Tip with browser wallet' }).click()
  await expect(bob.page.getByText('Tipped Alice 210 sats ⚡ Thank you!')).toBeVisible()

  // Friends see the sprite on Bob's podium spot.
  await publishRun(bob.sk)
  const carol = await onPodium(browser, 'Carol', [bob.pubkey])
  await expect(carol.page.getByRole('img', { name: new RegExp(`^${name} \\((win|happy)\\)$`) })).toBeVisible()
  expectNoErrors(alice, bob, carol)
})
