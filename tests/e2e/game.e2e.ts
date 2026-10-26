import { expect, test } from '@playwright/test'
import { createGame, expectNoErrors, goTo, joinGame, play, playerOnline, waitForStart } from './helpers'

test('two players find each other in the lobby and play to a win; a spectator sees the replay', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')

  const title = `Showdown ${Date.now()}`
  const path = await createGame(alice, { title, access: 'Anyone', timer: '6 blocks' })

  // Bob finds it in his lobby, labelled with who can join.
  await goTo(bob, '/')
  const card = bob.page.getByRole('link', { name: new RegExp(title, 'i') })
  await expect(card).toBeVisible()
  await expect(card.getByText('Anyone can join')).toBeVisible()
  await card.click()
  await joinGame(bob)

  // Alice's app admits Bob automatically; the host decides who goes first.
  const aliceFirst = await waitForStart(alice)
  await waitForStart(bob)
  const [first, second] = aliceFirst ? [alice, bob] : [bob, alice]

  // Board cells stay the same size as marks appear.
  const heights = () => first.page.getByRole('button', { name: /^Square/ }).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  const before = await heights()

  for (const [p, cell] of [[first, 0], [second, 3], [first, 4], [second, 5]] as const) await play(p, cell)
  // Same size as before, give or take a pixel of rounding (a cell may be caught mid-animation).
  const after = await heights()
  expect(Math.max(...after) - Math.min(...after)).toBeLessThanOrEqual(1)
  after.forEach((h, i) => expect(Math.abs(h - before[i])).toBeLessThanOrEqual(1))
  await play(first, 8)

  await expect(first.page.getByText('You win! 🏆')).toBeVisible()
  await expect(second.page.getByText(/You lost this one/)).toBeVisible()

  // Replaying a finished game never offers Resign.
  await expect(first.page.getByRole('button', { name: 'Resign' })).toHaveCount(0)
  await first.page.getByRole('button', { name: 'Watch replay' }).click()
  await expect(first.page.getByText(/Replay:/)).toBeVisible()
  await expect(first.page.getByRole('button', { name: 'Resign' })).toHaveCount(0)

  // A third player opens the link later and gets the full game from the relay, with a replay.
  const carol = await playerOnline(browser, 'Carol')
  await goTo(carol, path)
  await expect(carol.page.getByText(new RegExp(`${first.name} wins!`))).toBeVisible()
  await carol.page.getByRole('button', { name: 'Watch replay' }).click()
  await expect(carol.page.getByText(/Replay: (the game begins|move \d of 5)/)).toBeVisible()

  expectNoErrors(alice, bob, carol)
})

test('resigning ends the game for both players', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const path = await createGame(alice)
  await goTo(bob, path)
  await joinGame(bob)
  await waitForStart(alice)
  await waitForStart(bob)

  await bob.page.getByRole('button', { name: 'Resign' }).click()
  await bob.page.getByRole('button', { name: 'Yes, resign' }).click()
  await expect(bob.page.getByText('You resigned.')).toBeVisible()
  await expect(alice.page.getByText('Your opponent resigned. You win! 🏆')).toBeVisible()
  expectNoErrors(alice, bob)
})
