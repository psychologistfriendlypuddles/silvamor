import { expect, test } from '@playwright/test'
import { Relay } from 'nostr-tools/relay'
import { RELAY, expectNoErrors, onPodium, playerOnline, publishRun } from './helpers'

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

test('tipping a friend from the podium: any amount, as a plain zap to the person', async ({ browser }) => {
  const bob = await playerOnline(browser, 'Bob', '/', { wallet: true })
  await publishRun(bob.sk)
  const alice = await onPodium(browser, 'Alice', [bob.pubkey], { wallet: true })

  // Tapping Bob's spot opens his profile, with a tip button (any amount, starting at 21).
  await alice.page.getByRole('button', { name: /^\d\. Bob: / }).click()
  await alice.page.getByRole('button', { name: 'Tip Bob', exact: true }).click()
  await expect(alice.page.getByLabel('Tip in sats')).toHaveValue('21')
  await alice.page.getByLabel('Tip in sats').fill('500')
  await alice.page.getByRole('button', { name: 'Tip with browser wallet' }).click()
  await expect(alice.page.getByText('Tipped Bob 500 sats ⚡')).toBeVisible()

  // Tips are plain zaps to the person: they don't point at anything.
  await expect.poll(async () => (await tipRequests(bob.pubkey)).length).toBe(1)
  for (const request of await tipRequests(bob.pubkey)) expect(request.tags.some((t) => t[0] === 'a')).toBe(false)
  expectNoErrors(alice, bob)
})
