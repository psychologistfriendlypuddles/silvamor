import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { expectNoErrors, login, newPlayer, profileEvent, publishRun, seed } from './helpers'

test("a league's page: its standings over today, 7 or 21 days, today's hidden until you've played", async ({ browser }) => {
  const bob = generateSecretKey()
  const carol = generateSecretKey() // not in the league
  await seed(profileEvent(bob, 'Bob'), profileEvent(carol, 'Carol'))
  const alice = await newPlayer(browser, 'Alice')
  await seed({
    sk: alice.sk,
    template: { kind: 30000, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'friday'], ['title', 'Friday night miners'], ['p', getPublicKey(bob)]], content: '' },
  })
  await publishRun(bob, { fees: 5000, streak: 3 })
  await publishRun(bob, { fees: 4000, daysAgo: 1, streak: 2 })
  await publishRun(carol, { fees: 9000 })

  await login(alice, '/leagues')
  const { page } = alice
  await page.getByText('Friday night miners').click()
  await expect(page.getByRole('heading', { name: 'Friday night miners' })).toBeVisible()
  await expect(page.getByText('1 player, plus you')).toBeVisible()
  await expect(page.getByText("Mine today's block to see today's standings.")).toBeVisible()

  await publishRun(alice.sk, { fees: 6000 })
  await page.reload()
  await login(alice, '/leagues/friday')
  const standings = page.getByRole('list', { name: 'Standings' })
  await expect(standings.getByRole('button', { name: '1. You: 6,000 sats' })).toBeVisible()
  await expect(standings.getByRole('button', { name: '2. Bob: 5,000 sats' })).toBeVisible()
  await expect(standings.getByText('Carol')).toHaveCount(0)
  // Over 7 days, Bob's two blocks add up to more; his streak shows.
  await page.getByRole('tab', { name: '7 days' }).click()
  await expect(standings.getByRole('button', { name: '1. Bob: 9,000 sats' })).toBeVisible()
  await expect(standings.getByLabel('3-day streak')).toBeVisible()
  expectNoErrors(alice)
})
