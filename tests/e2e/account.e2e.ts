import { expect, test } from '@playwright/test'
import { expectNoErrors, goTo, playerOnline } from './helpers'

test('logging out from the profile page (the way out on phones)', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  // Phones have no sidebar; the header avatar opens the profile.
  await alice.page.getByRole('link', { name: 'Your profile' }).click()
  await alice.page.getByRole('button', { name: 'Log out' }).click()
  await alice.page.getByRole('button', { name: 'Log out' }).click() // confirm
  await expect(alice.page.getByRole('button', { name: /Private key/ })).toBeVisible()
  // Staying logged out after a reload.
  await goTo(alice, '/')
  await alice.page.reload()
  await expect(alice.page.getByRole('button', { name: /Private key/ })).toBeVisible()
  expectNoErrors(alice)
})
