import { expect, test } from '@playwright/test'
import * as nip19 from 'nostr-tools/nip19'
import { createGame, expectNoErrors, followsEvent, goTo, joinGame, newPlayer, login, playerOnline, seed, waitForStart } from './helpers'

test('an invite link can be redeemed once, and only with the link', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const path = await createGame(alice, { access: 'Invite link' })

  await alice.page.getByRole('button', { name: 'Copy invite link' }).click()
  const inviteLink = await alice.page.evaluate(() => navigator.clipboard.readText())
  expect(inviteLink).toMatch(/#invite=[0-9a-f]{32}$/)

  // Without the link's secret, nobody can take the seat.
  const dave = await playerOnline(browser, 'Dave')
  await goTo(dave, path)
  await expect(dave.page.getByText(/needs its invite link/)).toBeVisible()

  // Bob opens the invite link, even before logging in, and gets the seat.
  const bob = await newPlayer(browser, 'Bob')
  await login(bob, new URL(inviteLink).pathname + new URL(inviteLink).hash)
  await joinGame(bob)
  await waitForStart(alice)
  await waitForStart(bob)

  // The same link is now spent: Carol can only watch.
  const carol = await newPlayer(browser, 'Carol')
  await login(carol, new URL(inviteLink).pathname + new URL(inviteLink).hash)
  await expect(carol.page.getByText('Spectating')).toBeVisible()
  await expect(carol.page.getByRole('button', { name: 'Join game' })).toHaveCount(0)

  expectNoErrors(alice, bob, carol, dave)
})

test('a game for a group admits members only', async ({ browser }) => {
  const alice = await newPlayer(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const carol = await playerOnline(browser, 'Carol')
  await seed(followsEvent(alice.sk, [bob.pubkey, carol.pubkey]))
  await login(alice)

  // Alice makes a group with Bob, picked from the people she follows.
  await goTo(alice, '/groups')
  await alice.page.getByRole('button', { name: 'New group' }).click()
  await alice.page.getByPlaceholder('Friday night crew').fill('Board Game Night')
  await alice.page.getByRole('button', { name: /Bob$/ }).click()
  await alice.page.getByRole('button', { name: 'Create group' }).click()
  await expect(alice.page.getByText('1 member')).toBeVisible()

  const path = await createGame(alice, { access: 'Group', group: 'Board Game Night' })

  await goTo(bob, '/')
  await expect(bob.page.getByText(/Invite only · you’re on the list/)).toBeVisible()
  await goTo(carol, path)
  await expect(carol.page.getByText(/invite-only, and you're not on the list/)).toBeVisible()

  await goTo(bob, path)
  await joinGame(bob)
  await waitForStart(bob)
  expectNoErrors(alice, bob, carol)
})

test('inviting players: followed people are listed, filtered by name, with a warning when seats run out', async ({ browser }) => {
  const alice = await newPlayer(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const carol = await playerOnline(browser, 'Carol')
  const dave = await playerOnline(browser, 'Dave')
  await seed(followsEvent(alice.sk, [bob.pubkey, carol.pubkey]))
  await login(alice)

  await alice.page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  const form = alice.page.locator('form')
  await form.getByRole('button', { name: 'Invite only', exact: true }).click()

  const search = form.getByPlaceholder(/Search people you follow/)
  await search.click()
  await expect(form.getByRole('button', { name: /Bob$/ })).toBeVisible()
  await expect(form.getByRole('button', { name: /Carol$/ })).toBeVisible()

  // Only the displayed name is searched, not keys.
  await search.fill(nip19.npubEncode(bob.pubkey).slice(0, 12))
  await expect(form.getByRole('button', { name: /Bob$/ })).toHaveCount(0)

  await search.fill('car')
  await expect(form.getByRole('button', { name: /Bob$/ })).toHaveCount(0)
  await form.getByRole('button', { name: /Carol$/ }).click()
  await expect(form.getByText(/one seat for challengers/)).toHaveCount(0)

  // A second invitee for a two-player game: warn that only the first to join plays.
  await search.fill('bo')
  await form.getByRole('button', { name: /Bob$/ }).click()
  await expect(form.getByText(/one seat for challengers, and you've invited 2/)).toBeVisible()

  await form.getByRole('button', { name: 'Create game' }).click()
  await expect(alice.page.getByText('Waiting for an opponent…')).toBeVisible()
  const path = new URL(alice.page.url()).pathname

  // Both are invited; Bob joins first and gets the seat, Carol can watch. Dave isn't invited.
  await goTo(carol, '/')
  await expect(carol.page.getByText(/Invite only · you’re on the list/)).toBeVisible()
  await goTo(bob, path)
  await joinGame(bob)
  await waitForStart(bob)
  await goTo(carol, path)
  await expect(carol.page.getByText('Spectating')).toBeVisible()
  await goTo(dave, '/')
  await goTo(dave, path)
  await expect(dave.page.getByText('Spectating')).toBeVisible()
  expectNoErrors(alice, bob, carol, dave)
})
