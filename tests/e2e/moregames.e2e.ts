import { expect, test } from '@playwright/test'
import { createGame, expectNoErrors, goTo, joinGame, playOn, playerOnline, waitForStart, type GameOptions } from './helpers'

async function startGame(browser: Parameters<typeof playerOnline>[0], game: NonNullable<GameOptions['game']>, size?: string) {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const path = await createGame(alice, { game, size, title: `${game} ${Date.now()}` })
  await goTo(bob, path)
  await joinGame(bob)
  const aliceFirst = await waitForStart(alice)
  await waitForStart(bob)
  return { alice, bob, first: aliceFirst ? alice : bob, second: aliceFirst ? bob : alice }
}

test('reversi: a move flips the trapped disc, and only legal cells take a move', async ({ browser }) => {
  const { alice, bob, first, second } = await startGame(browser, 'Reversi')
  await expect(first.page.getByText('⚫ 2 · ⚪ 2')).toBeVisible()
  await expect(first.page.getByRole('button', { name: 'Cell 1-1' })).toBeDisabled()
  await playOn(first, 'Cell 3-4')
  await expect(second.page.getByText('⚫ 4 · ⚪ 1')).toBeVisible()
  await playOn(second, 'Cell 3-3')
  await expect(first.page.getByText('⚫ 3 · ⚪ 3')).toBeVisible()
  expectNoErrors(alice, bob)
})

test('checkers: captures are compulsory and remove the jumped piece', async ({ browser }) => {
  const { alice, bob, first, second } = await startGame(browser, 'Checkers')
  // Red (first) advances; white steps next to it; red must jump.
  await playOn(first, 'Square 6-3')
  await first.page.getByRole('button', { name: 'Square 5-4' }).click()
  await playOn(second, 'Square 3-6')
  await second.page.getByRole('button', { name: 'Square 4-5' }).click()
  await expect(first.page.getByText('You must capture.')).toBeVisible()
  await playOn(first, 'Square 5-4')
  await first.page.getByRole('button', { name: 'Square 3-6' }).click()
  await expect(second.page.getByText('Your turn!')).toBeVisible()
  await expect(second.page.getByRole('button', { name: 'Square 4-5' }).locator('span')).toHaveCount(0)
  expectNoErrors(alice, bob)
})

test('go: a capture, then two passes end the game with a score', async ({ browser }) => {
  const { alice, bob, first, second } = await startGame(browser, 'Go', '9×9')
  // Black surrounds white's corner stone at 1-2 and captures it.
  await playOn(first, 'Point 1-1')
  await playOn(second, 'Point 1-2')
  await playOn(first, 'Point 1-3')
  await playOn(second, 'Point 9-9')
  await playOn(first, 'Point 2-2')
  await expect(second.page.getByText('Captured: ⚫ 1 · ⚪ 0')).toBeVisible()
  await expect(second.page.getByText('Your turn!')).toBeVisible()
  await second.page.getByRole('button', { name: 'Pass' }).click()
  await expect(first.page.getByText(/Your opponent passed/)).toBeVisible()
  await first.page.getByRole('button', { name: 'Pass' }).click()
  await expect(first.page.getByText(/Score: ⚫ \d+ · ⚪ [\d.]+/)).toBeVisible()
  await expect(second.page.getByText(/Score:/)).toBeVisible()
  expectNoErrors(alice, bob)
})

test('gomoku: five in a row wins', async ({ browser }) => {
  const { alice, bob, first, second } = await startGame(browser, 'Gomoku')
  for (let c = 1; c <= 4; c++) {
    await playOn(first, `Point 8-${c}`)
    await playOn(second, `Point 9-${c}`)
  }
  await playOn(first, 'Point 8-5')
  await expect(first.page.getByText('You win! 🏆')).toBeVisible()
  await expect(second.page.getByText(/You lost this one/)).toBeVisible()
  expectNoErrors(alice, bob)
})

test("nine men's morris: a mill removes an opponent's piece", async ({ browser }) => {
  const { alice, bob, first, second } = await startGame(browser, "Nine Men's Morris")
  await playOn(first, 'Point 1')
  await playOn(second, 'Point 10')
  await playOn(first, 'Point 2')
  await playOn(second, 'Point 11')
  await playOn(first, 'Point 3') // 1-2-3: a mill
  await expect(first.page.getByText(/Mill! Tap one of your opponent’s pieces/)).toBeVisible()
  await first.page.getByRole('button', { name: 'Point 10' }).click()
  await expect(second.page.getByText('Your turn!')).toBeVisible()
  await expect(second.page.getByText('Place a piece (7 of 9 left).')).toBeVisible()
  expectNoErrors(alice, bob)
})
