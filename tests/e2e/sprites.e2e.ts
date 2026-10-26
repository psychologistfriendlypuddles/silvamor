import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { createGame, expectNoErrors, goTo, joinGame, play, playerOnline, waitForStart } from './helpers'

const OSTRICH_SHEET = fileURLToPath(new URL('../../public/sprites/ostrich.png', import.meta.url))

test("the players' sprites react to the game, and the waiting room shows the host's", async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const path = await createGame(alice)
  await expect(alice.page.getByRole('img', { name: 'Ostrich (idle)' })).toBeVisible()

  await goTo(bob, path)
  await expect(bob.page.getByRole('img', { name: 'Ostrich (happy)' })).toBeVisible()
  await joinGame(bob)
  const aliceFirst = await waitForStart(alice)
  await waitForStart(bob)
  const [first, second] = aliceFirst ? [alice, bob] : [bob, alice]

  // Whoever's turn it is thinks; a chat message makes the sender's sprite talk.
  const cards = first.page.locator('main')
  await expect(cards.getByRole('img', { name: 'Ostrich (thinking)' })).toHaveCount(1)
  await first.page.waitForTimeout(3500) // past the moment of loading history
  await second.page.getByLabel('Chat message', { exact: true }).fill('hmm')
  await second.page.getByLabel('Chat message', { exact: true }).press('Enter')
  await expect(cards.getByRole('img', { name: 'Ostrich (chat)' })).toBeVisible()

  for (const [p, cell] of [[first, 0], [second, 3], [first, 1], [second, 4], [first, 2]] as const) await play(p, cell)
  await expect(first.page.getByRole('img', { name: 'Ostrich (win)' })).toBeVisible()
  await expect(first.page.getByRole('img', { name: 'Ostrich (lose)' })).toBeVisible()
  expectNoErrors(alice, bob)
})

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

  // Another player sees Alice's new sprite in her game.
  const path = await createGame(alice)
  const bob = await playerOnline(browser, 'Bob')
  await goTo(bob, path)
  await expect(bob.page.getByRole('img', { name: 'Test bird (happy)' })).toBeVisible()
  expectNoErrors(alice, bob)
})
