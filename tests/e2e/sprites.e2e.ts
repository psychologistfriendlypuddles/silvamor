import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { expectNoErrors, goTo, onPodium, playerOnline, publishRun } from './helpers'

const OSTRICH_SHEET = fileURLToPath(new URL('../../public/sprites/ostrich.png', import.meta.url))

test('uploading your own sprite: checked against the standard, then everyone sees it', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  await goTo(alice, '/profile')
  const card = alice.page.locator('main')
  await expect(card.getByRole('img', { name: 'Ostrich (idle)' }).first()).toBeVisible()
  await card.getByRole('button', { name: '▶ Strike' }).click()
  await expect(card.getByRole('img', { name: 'Ostrich (strike)' })).toBeVisible()

  await card.getByRole('button', { name: 'Upload your own sprite' }).click()
  await card.getByPlaceholder('Disco duck').fill('Test bird')
  await card.getByLabel('Sprite sheet').setInputFiles(OSTRICH_SHEET)
  // The template manifest wants 128px frames: too big for this 64px sheet.
  await expect(card.getByText(/needs a sheet of at least 512×1408px/)).toBeVisible()
  await card.getByLabel('Manifest').fill(JSON.stringify({ version: 1, size: 64, pixelated: true, animations: { idle: { row: 0, frames: 4, fps: 4 }, win: { row: 4, frames: 6, fps: 10 } } }))
  await expect(card.getByRole('img', { name: 'Test bird (idle)' })).toBeVisible()
  await card.getByRole('button', { name: 'Publish and use it' }).click()
  await expect(alice.page.getByText('Test bird is now your sprite ✨')).toBeVisible()

  // A friend sees Alice's new sprite on the podium once they've both played.
  await publishRun(alice.sk)
  const bob = await onPodium(browser, 'Bob', [alice.pubkey])
  await expect(bob.page.getByRole('img', { name: /^Test bird \((win|happy)\)$/ })).toBeVisible()
  expectNoErrors(alice, bob)
})
