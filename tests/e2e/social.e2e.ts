import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { expectNoErrors, followsEvent, login, newPlayer, profileEvent, publishRun, seed } from './helpers'

const post = (sk: Uint8Array, content: string, tags: string[][] = [['t', 'blockoftheday']]) => ({
  sk,
  template: { kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content },
})

test("social: the game's posts, globally or from follows, and the global boards with podiums", async ({ browser }) => {
  const bob = generateSecretKey()
  const carol = generateSecretKey()
  const tag = `${Date.now()}`
  await seed(
    profileEvent(bob, 'Bob'),
    profileEvent(carol, 'Carol'),
    post(bob, `⛏️ Bob's block ${tag} #blockoftheday`),
    post(carol, `⛏️ Carol's block ${tag} #blockoftheday`),
    post(carol, `Carol's lunch ${tag}`, []), // not about the game
  )
  const alice = await newPlayer(browser, 'Alice')
  await seed(followsEvent(alice.sk, [getPublicKey(bob)]))
  await login(alice, '/social')
  const { page } = alice

  // The feed: everyone's posts with the game's hashtag, or just from people Alice follows.
  const posts = page.getByRole('list', { name: 'Posts' })
  await expect(posts.getByText(`⛏️ Bob's block ${tag} #blockoftheday`)).toBeVisible()
  await expect(posts.getByText(`⛏️ Carol's block ${tag} #blockoftheday`)).toBeVisible()
  await expect(posts.getByText(`Carol's lunch ${tag}`)).toHaveCount(0)
  await page.getByRole('tab', { name: 'My follows' }).click()
  await expect(posts.getByText(`⛏️ Bob's block ${tag} #blockoftheday`)).toBeVisible()
  await expect(posts.getByText(`⛏️ Carol's block ${tag} #blockoftheday`)).toHaveCount(0)

  // Top Scores: today's are hidden until Alice has played; then the best stand on the podium.
  await page.getByRole('tab', { name: 'Top Scores' }).click()
  await expect(page.getByText("Mine today's block to see today's top scores.")).toBeVisible()
  const bobToday = await publishRun(bob)
  const aliceToday = await publishRun(alice.sk)
  const bobYesterday = await publishRun(bob, { daysAgo: 1, fees: aliceToday }) // enough to lead over 7 days
  await page.reload()
  await login(alice, '/social')
  await page.getByRole('tab', { name: 'Top Scores' }).click()
  const podium = page.getByRole('list', { name: 'Podium' })
  await expect(podium.getByRole('button', { name: `1. You: ${aliceToday.toLocaleString('en-US')} sats` })).toBeVisible()
  await expect(podium.getByRole('button', { name: `2. Bob: ${bobToday.toLocaleString('en-US')} sats` })).toBeVisible()
  // Over 7 days, Bob's two blocks add up to more.
  await page.getByRole('tab', { name: '7 days' }).click()
  await expect(podium.getByRole('button', { name: `1. Bob: ${(bobToday + bobYesterday).toLocaleString('en-US')} sats` })).toBeVisible()

  // Top Streaks: days in a row, a streak from yesterday still counting today.
  const dave = generateSecretKey()
  await seed(profileEvent(dave, 'Dave'))
  await publishRun(dave, { daysAgo: 1, streak: 99_999 })
  await page.getByRole('tab', { name: 'Top Streaks' }).click()
  await expect(podium.getByRole('button', { name: '1. Dave: 🔥 99999 days' })).toBeVisible()
  expectNoErrors(alice)
})
