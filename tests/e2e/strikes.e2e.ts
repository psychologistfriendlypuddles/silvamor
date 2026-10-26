import { expect, test } from '@playwright/test'
import { Relay } from 'nostr-tools/relay'
import { RELAY, createGame, expectNoErrors, goTo, joinGame, mine, play, playOn, playerOnline, waitForStart, type Player } from './helpers'

/** Lets both apps notice new blocks: past the 30 s poll, then past the 60 s strike grace period. */
async function letBlocksSettle(...players: Player[]) {
  for (const time of ['00:31', '01:01']) {
    await Promise.all(players.map((p) => p.page.clock.fastForward(time)))
  }
  // Run a few seconds normally so strike filing (after a short random wait) and animations finish.
  await Promise.all(players.map((p) => p.page.clock.runFor(6000)))
}

/** Blocks of the strike actions filed on the relay (Option B: anyone's app files them), each once. */
async function filedStrikes(): Promise<number[]> {
  const relay = await Relay.connect(RELAY)
  const events = await new Promise<{ content: string; tags: string[][] }[]>((resolve) => {
    const found: { content: string; tags: string[][] }[] = []
    const sub = relay.subscribe([{ kinds: [1951] }], {
      onevent: (e) => found.push(e),
      oneose: () => {
        sub.close()
        resolve(found)
      },
    })
  })
  relay.close()
  const blocks = events.filter((e) => JSON.parse(e.content).type === 'strike').map((e) => Number(e.tags.find((t) => t[0] === 'block')![1]))
  return [...new Set(blocks)].sort()
}

test('three strikes: a missed turn gives a strike but keeps the turn; the third strike loses', async ({ browser }) => {
  // Fake clocks let the test skip the 30 s block polling and 60 s grace period instead of waiting.
  const alice = await playerOnline(browser, 'Alice', '/', { fakeClock: true })
  const bob = await playerOnline(browser, 'Bob', '/', { fakeClock: true })

  // Creating a 1-block game warns how short that can be.
  await goTo(alice, '/')
  await alice.page.getByRole('button', { name: 'Create game', exact: true }).first().click()
  const form = alice.page.locator('form')
  await form.getByRole('button', { name: '1 block', exact: true }).click()
  await expect(form.getByText(/your strike lands on the very next block/)).toBeVisible()
  await form.getByRole('button', { name: 'Create game' }).click()
  await expect(alice.page.getByText('Waiting for an opponent…')).toBeVisible()
  const path = new URL(alice.page.url()).pathname

  await goTo(bob, path)
  await joinGame(bob)
  const aliceFirst = await waitForStart(alice)
  await waitForStart(bob)
  const [first, second] = aliceFirst ? [alice, bob] : [bob, alice]

  // First player moves in time. Second player's turn starts at that block: strikes at +1, +2, +3.
  await expect(first.page.getByText(/Next strike at block/)).toBeVisible()
  await play(first, 4)

  // One block passes: one strike, and it's still the second player's turn.
  await mine(1)
  await letBlocksSettle(first, second)
  await expect(second.page.getByText('⚡ Strike! Still your turn.')).toBeVisible()
  await expect(second.page.getByLabel('1 of 3 strikes')).toBeVisible()
  await expect(first.page.getByLabel('1 of 3 strikes')).toBeVisible()
  await expect.poll(filedStrikes).toHaveLength(1)

  // The struck player can still move; the strike stays on their record.
  await play(second, 0)
  await expect(second.page.getByLabel('1 of 3 strikes')).toBeVisible()

  // Now the first player goes idle for three blocks: three strikes, out.
  await mine(3)
  await letBlocksSettle(first, second)
  await expect(first.page.getByText("Three strikes, you're out. ⚡")).toBeVisible()
  await expect(second.page.getByText('Three strikes for your opponent. You win! 🏆')).toBeVisible()
  await expect.poll(filedStrikes).toHaveLength(4)

  // A spectator arriving later reads the same result from the record.
  const carol = await playerOnline(browser, 'Carol')
  await goTo(carol, path)
  await expect(carol.page.getByText(new RegExp(`${second.name} wins \\(three strikes\\)!`))).toBeVisible()

  // Their replay starts with no strikes and shows each one as it lands.
  await carol.page.getByRole('button', { name: 'Watch replay' }).click()
  await carol.page.getByRole('button', { name: 'First move' }).click()
  await expect(carol.page.getByLabel('0 of 3 strikes')).toHaveCount(2)
  await carol.page.getByRole('button', { name: 'Next move' }).click()
  await expect(carol.page.getByText(/Replay: move 1 of/)).toBeVisible()
  await carol.page.getByRole('button', { name: 'Next move' }).click()
  await expect(carol.page.getByText(new RegExp(`Replay: ⚡ strike 1 for ${second.name}`))).toBeVisible()
  await expect(carol.page.getByLabel('1 of 3 strikes')).toHaveCount(1)
  expectNoErrors(alice, bob, carol)
})

test('dots and boxes: running out of time passes the turn to the opponent', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { fakeClock: true })
  const bob = await playerOnline(browser, 'Bob', '/', { fakeClock: true })
  const path = await createGame(alice, { game: 'Dots and Boxes', size: '8×8', timer: '1 block' })
  await goTo(bob, path)
  await joinGame(bob)
  const aliceFirst = await waitForStart(alice)
  await waitForStart(bob)
  const [first, second] = aliceFirst ? [alice, bob] : [bob, alice]

  // The rules sheet explains it.
  await first.page.getByRole('button', { name: 'Rules' }).click()
  await expect(first.page.getByText(/the turn passes to your opponent/)).toBeVisible()
  await expect(first.page.getByText(/Wager/)).toHaveCount(0) // wagers are off in this build
  await first.page.getByRole('button', { name: 'Close rules' }).click()

  // The first player idles past their block: a strike, and the second player's turn.
  await mine(1)
  await letBlocksSettle(first, second)
  await expect(second.page.getByText('Out of time: strike, and the turn passed to you.')).toBeVisible()
  await expect(second.page.getByText('Your turn!')).toBeVisible()
  await expect(second.page.getByLabel('1 of 3 strikes')).toBeVisible()
  await expect(first.page.getByText('Waiting for your opponent…')).toBeVisible()

  // The second player moves on top of the strike, and it's the first player's turn again.
  await playOn(second, 'Line 1')
  await expect(first.page.getByText('Your turn!')).toBeVisible()
  await playOn(first, 'Line 9')
  await expect(second.page.getByText('Your turn!')).toBeVisible()
  expectNoErrors(alice, bob)
})
