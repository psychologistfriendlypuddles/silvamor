import { expect, test } from '@playwright/test'
import { createGame, expectNoErrors, goTo, joinGame, play, playerOnline, waitForStart } from './helpers'

test('table talk: the players chat; spectators see no chat', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const path = await createGame(alice)
  await goTo(bob, path)
  await joinGame(bob)
  await waitForStart(alice)
  await waitForStart(bob)

  await bob.page.getByLabel('Chat message', { exact: true }).fill('gl hf 🎲')
  await bob.page.getByRole('button', { name: 'Send' }).click()
  await expect(alice.page.getByLabel('Chat messages').getByText('gl hf 🎲')).toBeVisible()
  await alice.page.getByLabel('Chat message', { exact: true }).fill('you too!')
  await alice.page.getByLabel('Chat message', { exact: true }).press('Enter')
  await expect(bob.page.getByLabel('Chat messages').getByText('you too!')).toBeVisible()

  const carol = await playerOnline(browser, 'Carol')
  await goTo(carol, path)
  await expect(carol.page.getByText('Spectating')).toBeVisible()
  await expect(carol.page.getByText('table talk')).toHaveCount(0)
  await expect(carol.page.getByText('gl hf 🎲')).toHaveCount(0)
  expectNoErrors(alice, bob, carol)
})

test('notifications: joined, your turn and chat arrive while elsewhere in the app', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const path = await createGame(alice)
  await goTo(alice, '/') // Alice waits in the lobby

  await goTo(bob, path)
  await joinGame(bob)
  await expect(alice.page.getByText(/🎉 Bob joined your game/)).toBeVisible()

  await waitForStart(bob)
  // Whoever moves first, the other is the one we watch from the lobby.
  await goTo(alice, path)
  const aliceFirst = await waitForStart(alice)
  const [mover, waiter] = aliceFirst ? [alice, bob] : [bob, alice]
  await goTo(waiter, '/')

  await play(mover, 4)
  await expect(waiter.page.getByText(/🎯 Your turn in/)).toBeVisible()
  await expect(waiter.page.locator('[aria-label$=" unread"]:visible')).toBeVisible()

  await mover.page.getByLabel('Chat message', { exact: true }).fill('your move 😏')
  await mover.page.getByRole('button', { name: 'Send' }).click()
  // Tapping a notification pop-up opens its game.
  const chatToast = waiter.page.getByRole('button', { name: /💬 .*: your move 😏/ })
  await expect(chatToast).toBeVisible()
  await chatToast.click()
  await expect(waiter.page.getByText('Your turn!')).toBeVisible()

  // The Alerts page lists them; opening one goes to the game and clears the badge.
  await goTo(waiter, '/notifications')
  await waiter.page.locator('main').getByRole('button', { name: /Your turn in/ }).click()
  await expect(waiter.page.getByText('Your turn!')).toBeVisible()
  await expect(waiter.page.locator('[aria-label$=" unread"]')).toHaveCount(0)
  expectNoErrors(alice, bob)
})
