import { expect, test } from '@playwright/test'
import { goTo, playerOnline } from './helpers'

test('the terms and privacy policy can be read before logging in, and from the app', async ({ page, browser }) => {
  await page.goto('/')
  await expect(page.getByText(/By logging in you confirm you’re 18 or older/)).toBeVisible()
  await page.getByRole('link', { name: 'terms of use' }).click()
  await expect(page.getByRole('heading', { name: 'terms of use' })).toBeVisible()
  await expect(page.getByText(/We never hold, receive, send or control anyone’s money/)).toBeVisible()
  await page.getByRole('link', { name: 'privacy policy' }).click()
  await expect(page.getByRole('heading', { name: 'privacy policy' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Silvamor' }).click()
  await expect(page.getByRole('button', { name: /Private key/ })).toBeVisible()

  const alice = await playerOnline(browser, 'Alice')
  await goTo(alice, '/profile')
  await alice.page.locator('main').getByRole('link', { name: 'Terms' }).click()
  await expect(alice.page.getByRole('heading', { name: 'terms of use' })).toBeVisible()
})
