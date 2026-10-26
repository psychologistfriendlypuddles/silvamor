import { expect, test } from '@playwright/test'
import { WAGERS_URL, createGame, expectNoErrors, goTo, playerOnline, waitForStart, type Player } from './helpers'

// Wagers are off unless the app is built with VITE_ENABLE_WAGERS=true; these run against that build.
test.use({ baseURL: WAGERS_URL })

/** The non-host joins after agreeing to the wager; returns once the game started for both. */
async function joinWager(host: Player, joiner: Player, path: string, label: RegExp) {
  await goTo(joiner, path)
  await expect(joiner.page.getByText(label)).toBeVisible()
  const join = joiner.page.getByRole('button', { name: 'Join game' })
  await expect(join).toBeDisabled()
  await joiner.page.getByLabel(/I agree to wager/).check()
  await join.click()
  await waitForStart(host)
  await waitForStart(joiner)
}

async function resign(player: Player) {
  await player.page.getByRole('button', { name: 'Resign' }).click()
  await player.page.getByRole('button', { name: /Yes, resign/ }).click()
}

test('creating a wager shows the warnings, louder for big stakes', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { wallet: true })
  await alice.page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  const form = alice.page.locator('form')
  await expect(form.getByText('Honor system.')).toHaveCount(0)
  await form.getByLabel('Wager', { exact: true }).check()
  await expect(form.getByLabel('Wager in sats')).toHaveValue('21')
  await expect(form.getByText('Honor system.')).toBeVisible()
  await expect(form.getByText(/beta software/)).toBeVisible()
  await expect(form.getByText(/friendly wagers only/)).toHaveCount(0)

  await form.getByLabel('Wager in sats').fill('5000')
  await expect(form.getByText(/friendly wagers only/)).toBeVisible()
  // The slider runs from 1 sat to 1 BTC.
  await form.getByLabel('Wager amount').fill('1000')
  await expect(form.getByLabel('Wager in sats')).toHaveValue('100000000')
  await form.getByLabel('Wager amount').fill('0')
  await expect(form.getByLabel('Wager in sats')).toHaveValue('1')
  expectNoErrors(alice)
})

test('a wager game needs a Lightning address that takes zaps', async ({ browser }) => {
  const dave = await playerOnline(browser, 'Dave')
  await dave.page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  const form = dave.page.locator('form')
  await form.getByLabel('Wager', { exact: true }).check()
  await expect(form.getByText(/You need a Lightning address/)).toBeVisible()
  await form.getByLabel(/Wagering on games is legal where I live/).check()
  await form.getByRole('button', { name: 'Create game' }).click()
  await expect(dave.page.getByText(/To wager, add a Lightning address/)).toBeVisible()
  expectNoErrors(dave)
})

test('the loser pays the wager with a zap and everyone sees it paid', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { wallet: true })
  const bob = await playerOnline(browser, 'Bob', '/', { wallet: true })
  const title = `Stakes ${Date.now()}`
  const path = await createGame(alice, { title, wager: 2100 })

  // The lobby card shows the stake.
  await goTo(bob, '/')
  const card = bob.page.getByRole('link', { name: new RegExp(title, 'i') })
  await expect(card.getByText('2,100 sats')).toBeVisible()

  await joinWager(alice, bob, path, /This game has a 2,100 sats wager/)
  await resign(bob)

  await expect(bob.page.getByText(/You owe Alice 2,100 sats/)).toBeVisible()
  await expect(alice.page.getByText(/Waiting for Bob to zap you 2,100 sats/)).toBeVisible()
  await bob.page.getByRole('button', { name: 'Pay with browser wallet' }).click()

  // The provider's zap receipt is the proof, for both players.
  await expect(bob.page.getByText('Wager paid: Bob zapped Alice 2,100 sats.')).toBeVisible()
  await expect(alice.page.getByText('Wager paid: Bob zapped Alice 2,100 sats.')).toBeVisible()
  expectNoErrors(alice, bob)
})

test('an unpaid wager turns the honor badge red after 24 hours', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { wallet: true })
  const bob = await playerOnline(browser, 'Bob', '/', { wallet: true })
  const path = await createGame(alice, { wager: 21 })
  await joinWager(alice, bob, path, /This game has a 21 sats wager/)

  // A fresh player is "new", not red.
  await expect(alice.page.getByRole('img', { name: /^New/ }).first()).toBeVisible()
  await resign(bob)
  await expect(alice.page.getByText(/Waiting for Bob to zap you 21 sats/)).toBeVisible()

  // A day later, Bob still hasn't paid.
  const carol = await playerOnline(browser, 'Carol', path, { fakeClock: 25 * 3600_000 })
  await expect(carol.page.getByText("Bob hasn't paid the 21 sats wager yet.")).toBeVisible()
  await expect(carol.page.getByRole('img', { name: /^Red · owes 1 wager \(1 hour overdue\)/ }).first()).toBeVisible()
  expectNoErrors(alice, bob, carol)
})

test('a wager needs the creator to confirm it is legal for them', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { wallet: true })
  await alice.page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  const form = alice.page.locator('form')
  await form.getByLabel('Wager', { exact: true }).check()
  await expect(form.getByText(/Only wager where it’s legal for you/)).toBeVisible()
  await form.getByRole('button', { name: 'Create game' }).click()
  await expect(alice.page.getByText(/Confirm that wagering is legal where you live/)).toBeVisible()
})
