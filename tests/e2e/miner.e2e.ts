import { expect, test, type Page } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { RELAY, expectNoErrors, followsEvent, login, newPlayer, profileEvent, publishMinerRun, publishRun, seed, today, todaysDeal } from './helpers'
import { blocked, encodeMoves, minerFees, minerMoves, minerRules, type MinerMove } from '../../src/games/miner/rules'
import { shortSats } from '../../src/games/miner/share'

const sats = (n: number) => `${n.toLocaleString('en-US')} sats`
/** The card on offer is transaction `n` (counting from 1). */
const onOffer = (page: Page, n: number) => expect(page.getByLabel('On offer').locator('span').first()).toHaveText(`#${n}`)

/** Swipes the card on offer: down takes it, up passes on it. */
async function swipe(page: Page, move: MinerMove) {
  const box = (await page.getByLabel('On offer').boundingBox())!
  const x = box.x + box.width / 3
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + (move === 'take' ? 110 : -110), { steps: 8 })
  await page.mouse.up()
}

test('block of the day: take or pass until the block is found, then a streak and a note to share', async ({ browser }) => {
  const { deal } = await todaysDeal()
  // Bob played like the miner; Alice follows him.
  const bob = generateSecretKey()
  await seed(profileEvent(bob, 'Bob'))
  await publishMinerRun(bob, encodeMoves(minerMoves(deal)), minerFees(deal))
  const alice = await newPlayer(browser, 'Alice')
  await seed(followsEvent(alice.sk, [getPublicKey(bob)]))
  // Alice played the last four days.
  await publishRun(alice.sk, { daysAgo: 1, streak: 4, fees: 1 })

  // Block of the Day is the home page.
  await login(alice)
  const { page } = alice
  await expect(page.getByRole('heading', { name: 'Block of the Day' })).toBeVisible()
  await expect(page.getByText("1 friend has played today. Finish your block to see today's scores.")).toBeVisible()
  // Today's seed block and its players, and the last 7 games in a popup.
  await expect(page.getByText(/^Current block [\d,]+ has [\d,]+ players?/)).toBeVisible()
  await expect(page.getByText(/^Today's game ends at .+ your time \(midnight UTC\)\.$/)).toBeVisible()
  await page.getByRole('button', { name: 'View last 7 games' }).click()
  const games = page.getByRole('table', { name: 'The last 7 games' })
  await expect(games.getByRole('row')).toHaveCount(8)
  await expect(games.getByRole('row').nth(1)).toContainText(today())
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(games).toHaveCount(0)

  // Alice takes everything she can, as the app allows it.
  const rules = minerRules(deal)
  let state = rules.init()
  const moves: MinerMove[] = []
  const decide = () => {
    const move: MinerMove = blocked(deal, state, state.next) === null ? 'take' : 'pass'
    state = rules.apply(state, move)
    moves.push(move)
    return move
  }
  for (let i = 0; i < 3; i++) {
    await onOffer(page, i + 1)
    await page.getByRole('button', { name: decide() === 'take' ? 'Take' : 'Pass' }).click()
  }
  await expect(page.getByLabel('Your fees', { exact: true })).toHaveText(sats(state.fees))

  // Logging in again finds the run where it was left.
  await page.reload()
  await login(alice)
  await onOffer(page, 4)
  await expect(page.getByLabel('Your fees', { exact: true })).toHaveText(sats(state.fees))

  // Swiping decides too: down takes, up passes; a short swipe springs back and decides nothing.
  const box = (await page.getByLabel('On offer').boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 4 })
  await page.mouse.up()
  await onOffer(page, 4)
  for (let i = 0; i < 2; i++) {
    const n = state.next
    await swipe(page, decide())
    await onOffer(page, n + 2)
  }
  await expect(page.getByLabel('Your fees', { exact: true })).toHaveText(sats(state.fees))

  while (!state.found) {
    const take = blocked(deal, state, state.next) === null
    if (!take) await expect(page.getByRole('button', { name: 'Take' })).toBeDisabled()
    decide()
    await page.getByRole('button', { name: take ? 'Take' : 'Pass' }).click()
  }

  // The block is found: her fees against the miner's, and the share offer.
  await expect(page.getByText(`Block found after ${deal.foundAt} transactions`)).toBeVisible()
  await expect(page.getByLabel('Your fees')).toHaveText(sats(state.fees))
  // How it compares with the miner, in sats.
  const miner = minerFees(deal)
  await expect(page.getByText(`The miner's block: ${sats(miner)}`)).toBeVisible()
  const versus = state.fees === miner ? 'level with the miner' : `${shortSats(Math.abs(state.fees - miner))} ${state.fees > miner ? 'ahead of' : 'behind'} the miner`
  await expect(page.getByRole('textbox', { name: 'Your note' })).toHaveValue(new RegExp(`^⛏️ Block of the Day ${today()}, block [\\d,]+: ${versus.replace('.', '\\.')}\\n`))
  await expect(page.getByRole('textbox', { name: 'Your note' })).toHaveValue(/\n🔥 5-day streak\n/)
  await expect(page.getByRole('textbox', { name: 'Your note' })).toHaveValue(/ #blockoftheday$/)
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByText('🔥 5-day streak', { exact: true })).toBeVisible()

  // Published (the note is offered once it is), with no standings on the result screen.
  await expect(page.getByLabel('Standings')).toHaveCount(0)
  const relay = await Relay.connect(RELAY)
  const runs = await new Promise<{ content: string; tags: string[][] }[]>((resolve) => {
    const found: { content: string; tags: string[][] }[] = []
    const sub = relay.subscribe([{ kinds: [1953], authors: [alice.pubkey], '#l': [today()] }], { onevent: (e) => found.push(e), oneose: () => (sub.close(), resolve(found)) })
  })
  relay.close()
  expect(runs.map((r) => JSON.parse(r.content).moves)).toEqual([encodeMoves(moves)])
  expect(runs[0].tags).toContainEqual(['score', String(state.fees)])
  expect(runs[0].tags).toContainEqual(['streak', '5'])
  // Runs name nobody: there are no "beat your block" notices.
  expect(runs[0].tags.some((t) => t[0] === 'p')).toBe(false)
  expectNoErrors(alice)
})
