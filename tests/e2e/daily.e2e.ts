import { expect, test, type Page } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { RELAY, STRATEGIES, expectNoErrors, followsEvent, login, newPlayer, profileEvent, publishRun, publishYesterday, runWith, seed, today } from './helpers'

const hand = (page: Page) => page.getByRole('group', { name: 'Your hand' }).getByRole('button')
const stat = (page: Page, label: string) => page.getByLabel(label, { exact: true })
const points = (n: number) => n.toLocaleString('en-US')
const podium = (page: Page, place: number, who: string, score: number) => page.getByRole('button', { name: `${place}. ${who}: ${points(score)}` })

/** Selects the first `n` cards of the hand and returns the points the preview promises. */
async function pick(page: Page, n: number) {
  for (let i = 0; i < n; i++) await hand(page).nth(i).click()
  const preview = await page.getByText(/ = [\d,]+$/).textContent()
  return Number(preview!.split('=')[1].replace(/\D/g, ''))
}

test('daily deal: discard, play every hand with your sprite cheering, and keep the run across a reload', async ({ browser }) => {
  const alice = await newPlayer(browser, 'Alice')
  await login(alice)
  const { page } = alice
  // Beat the Miner is home; Daily Deal is in the menu.
  await page.getByRole('link', { name: 'Daily Deal' }).first().click()
  await expect(page.getByRole('heading', { name: 'Daily Deal' })).toBeVisible()
  await expect(page.getByRole('list', { name: "Today's perks" }).getByRole('listitem')).toHaveCount(3)
  await expect(hand(page)).toHaveCount(8)
  await expect(page.getByRole('img', { name: 'Ostrich (idle)' })).toBeVisible()

  // No more than five cards can be picked; the cheerleader thinks it over.
  for (let i = 0; i < 6; i++) await hand(page).nth(i).click()
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(5)
  await expect(page.getByRole('img', { name: 'Ostrich (thinking)' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(stat(page, 'Discards')).toHaveText('2')
  await expect(hand(page)).toHaveCount(8)
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(0)

  // A lone card is only a high card: commiserations.
  const hands = Number(await stat(page, 'Hands').textContent())
  await hand(page).last().click()
  let expected = await pick(page, 0)
  await page.getByRole('button', { name: 'Play hand' }).click()
  await expect(page.getByRole('img', { name: 'Ostrich (sad)' })).toBeVisible()
  await expect(stat(page, 'Score')).toHaveText(points(expected))
  await expect(stat(page, 'Hands')).toHaveText(String(hands - 1))

  // Logging in again finds the run where it was left.
  await page.reload()
  await login(alice, '/daily-deal')
  await expect(stat(page, 'Score')).toHaveText(points(expected))
  await expect(stat(page, 'Discards')).toHaveText('2')

  for (let left = hands - 1; left > 0; left--) {
    expected += await pick(page, 5)
    await page.getByRole('button', { name: 'Play hand' }).click()
  }
  await expect(page.getByText('Run complete')).toBeVisible()
  await expect(page.getByLabel('Final score')).toHaveText(points(expected))
  await expect(page.getByRole('list', { name: 'Hands played' }).getByRole('listitem')).toHaveCount(hands)
  await expect(page.getByText(/A new deal in \d+h \d+m/)).toBeVisible()
  // Published: Alice tops her own podium.
  await expect(podium(page, 1, 'You', expected)).toBeVisible()
  await expect(page.getByRole('list', { name: 'Podium' }).getByRole('listitem')).toHaveCount(1)

  // Then an offer to share it as a note, which she can edit first.
  const note = page.getByRole('textbox', { name: 'Your note' })
  await expect(note).toHaveValue(new RegExp(String.raw`^🃏 Daily Deal ${today()}: ${points(expected)} points\nBest hand: .+\nSame cards for everyone today\. Can you beat me\?\nhttp`))
  await note.press('ControlOrMeta+End')
  await note.pressSequentially(' #silvamor')
  await page.getByRole('button', { name: 'Post to Nostr' }).click()
  await expect(page.getByText('Shared to 1 relay 🎉')).toBeVisible()
  await expect(note).toBeHidden()
  const relay = await Relay.connect(RELAY)
  const notes = await new Promise<{ content: string }[]>((resolve) => {
    const found: { content: string }[] = []
    const sub = relay.subscribe([{ kinds: [1], authors: [alice.pubkey] }], { onevent: (e) => found.push(e), oneose: () => (sub.close(), resolve(found)) })
  })
  relay.close()
  expect(notes.map((n) => n.content)).toEqual([expect.stringMatching(/ #silvamor$/)])

  // It's offered once a day.
  await page.reload()
  await login(alice, '/daily-deal')
  await expect(podium(page, 1, 'You', expected)).toBeVisible()
  await expect(note).toBeHidden()
  expectNoErrors(alice)
})

test('daily deal: runs are published, friends on the podium, and a friend who beats you is announced', async ({ browser }) => {
  // Alice will play her top five cards each hand; Carol does worse and Bob better, whatever today's perks favour.
  const mine = await runWith(STRATEGIES.topFive)
  const tries = await Promise.all([STRATEGIES.lowest, STRATEGIES.bottomFive, STRATEGIES.highest].map(runWith))
  const lowest = tries.sort((a, b) => a.score - b.score)[0]
  const best = await runWith(STRATEGIES.best)
  test.skip(!(lowest.score < mine.score && mine.score < best.score), "today's deal doesn't separate the three runs")

  const bob = generateSecretKey()
  const carol = generateSecretKey()
  await seed(profileEvent(bob, 'Bob'), profileEvent(carol, 'Carol'))
  const alice = await newPlayer(browser, 'Alice')
  await seed(followsEvent(alice.sk, [getPublicKey(bob), getPublicKey(carol)]))
  await publishRun(carol, { run: lowest })
  // Alice played the last four days.
  await publishYesterday(alice.sk, 4)

  await login(alice, '/daily-deal')
  const { page } = alice
  await expect(page.getByText('1 friend has played today. Finish your run to see the scores.')).toBeVisible()
  const hands = Number(await stat(page, 'Hands').textContent())
  let score = 0
  for (let left = hands; left > 0; left--) {
    score += await pick(page, 5)
    await page.getByRole('button', { name: 'Play hand' }).click()
  }
  expect(score).toBe(mine.score)
  await expect(podium(page, 1, 'You', mine.score)).toBeVisible()
  await expect(podium(page, 2, 'Carol', lowest.score)).toBeVisible()
  // Today makes five days in a row; Carol has no streak.
  await expect(page.getByRole('textbox', { name: 'Your note' })).toHaveValue(/\n🔥 5-day streak\n/)
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('textbox', { name: 'Your note' })).toBeHidden()
  await expect(page.getByText('🔥 5-day streak')).toBeVisible()
  await expect(podium(page, 1, 'You', mine.score).getByLabel('5-day streak')).toBeVisible()
  await expect(podium(page, 2, 'Carol', lowest.score).getByLabel(/streak/)).toHaveCount(0)

  // Alice's published run tags Carol, whom she beat.
  const relay = await Relay.connect(RELAY)
  const runs = await new Promise<{ tags: string[][] }[]>((resolve) => {
    const found: { tags: string[][] }[] = []
    const sub = relay.subscribe([{ kinds: [1952], authors: [alice.pubkey], '#l': [today()] }], { onevent: (e) => found.push(e), oneose: () => (sub.close(), resolve(found)) })
  })
  relay.close()
  expect(runs).toHaveLength(1)
  expect(runs[0].tags.filter((t) => t[0] === 'p').map((t) => t[1])).toEqual([getPublicKey(carol)])
  expect(runs[0].tags.find((t) => t[0] === 'streak')).toEqual(['streak', '5'])

  // Bob then beats her: he takes gold, and Alice hears about it. His 9-day streak is made up
  // (he didn't play yesterday), so it doesn't show.
  await publishRun(bob, { run: best, beaten: [alice.pubkey], streak: 9 })
  await expect(podium(page, 1, 'Bob', best.score)).toBeVisible()
  await expect(podium(page, 1, 'Bob', best.score).getByLabel(/streak/)).toHaveCount(0)
  await expect(podium(page, 2, 'You', mine.score)).toBeVisible()
  await expect(podium(page, 3, 'Carol', lowest.score)).toBeVisible()
  await expect(page.getByText(`🃏 Bob beat your Daily Deal score with ${points(best.score)}`)).toBeVisible()
  await login(alice, '/notifications')
  await page.getByText(/Bob beat your Daily Deal score/).click()
  await expect(page.getByRole('heading', { name: 'Daily Deal' })).toBeVisible()
  expectNoErrors(alice)
})
