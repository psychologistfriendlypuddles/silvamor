import { expect, test } from '@playwright/test'
import { Relay } from 'nostr-tools/relay'
import { RELAY, createGame, expectNoErrors, goTo, joinGame, playerOnline, waitForStart } from './helpers'

/** The zap requests inside the receipts for tips to `pubkey`. */
async function tipRequests(pubkey: string): Promise<{ tags: string[][] }[]> {
  const relay = await Relay.connect(RELAY)
  const receipts = await new Promise<{ tags: string[][] }[]>((resolve) => {
    const found: { tags: string[][] }[] = []
    const sub = relay.subscribe([{ kinds: [9735], '#p': [pubkey] }], {
      onevent: (e) => found.push(e),
      oneose: () => {
        sub.close()
        resolve(found)
      },
    })
  })
  relay.close()
  return receipts.map((r) => JSON.parse(r.tags.find((t) => t[0] === 'description')![1]))
}

test('thank-you tips: none during the game, then 21 sats for anyone after it, and any amount from a profile', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { wallet: true })
  const bob = await playerOnline(browser, 'Bob', '/', { wallet: true })
  const path = await createGame(alice)
  await goTo(bob, path)
  await joinGame(bob)
  await waitForStart(alice)
  await waitForStart(bob)

  // During the game: no tips, not even from the opponent's profile.
  await expect(alice.page.getByText(/thank-you tip/)).toHaveCount(0)
  await alice.page.getByRole('button', { name: "Bob's profile" }).click()
  await expect(alice.page.getByText('Tips open once your game together is over.')).toBeVisible()
  await alice.page.getByRole('button', { name: 'Close profile' }).click()

  // The game ends (whoever wins, it's the same for both).
  await bob.page.getByRole('button', { name: 'Resign' }).click()
  await bob.page.getByRole('button', { name: 'Yes, resign' }).click()
  await expect(bob.page.getByText('Good game! Send Alice a thank-you tip ⚡')).toBeVisible()
  await expect(alice.page.getByText('Good game! Send Bob a thank-you tip ⚡')).toBeVisible()

  // A flat 21 sats, straight to the other player.
  await bob.page.getByRole('button', { name: 'Tip Alice 21 sats' }).click()
  await bob.page.getByRole('button', { name: 'Tip with browser wallet' }).click()
  await expect(bob.page.getByText('Tipped Alice 21 sats ⚡')).toBeVisible()

  // Spectators can thank either player.
  const carol = await playerOnline(browser, 'Carol', path)
  await expect(carol.page.getByText('Good game! Send a player a thank-you tip ⚡')).toBeVisible()
  await expect(carol.page.getByRole('button', { name: /^Tip (Alice|Bob) 21 sats$/ })).toHaveCount(2)

  // From a profile, any amount (starting at 21).
  await alice.page.getByRole('button', { name: "Bob's profile" }).click()
  await alice.page.getByRole('button', { name: 'Tip Bob', exact: true }).click()
  await expect(alice.page.getByLabel('Tip in sats')).toHaveValue('21')
  await alice.page.getByLabel('Tip in sats').fill('500')
  await alice.page.getByRole('button', { name: 'Tip with browser wallet' }).click()
  await expect(alice.page.getByText('Tipped Bob 500 sats ⚡')).toBeVisible()

  // Tips are plain zaps to the person: they don't point at the game.
  await expect.poll(async () => (await tipRequests(alice.pubkey)).length).toBe(1)
  for (const request of [...(await tipRequests(alice.pubkey)), ...(await tipRequests(bob.pubkey))]) {
    expect(request.tags.some((t) => t[0] === 'a')).toBe(false)
  }
  expectNoErrors(alice, bob, carol)
})
