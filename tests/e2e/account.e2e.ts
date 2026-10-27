import { expect, test } from '@playwright/test'
import { Relay } from 'nostr-tools/relay'
import type { Event } from 'nostr-tools/pure'
import { RELAY, expectNoErrors, goTo, playerOnline } from './helpers'

/** The requests to vanish (NIP-62) `pubkey` sent to the test relay. */
async function vanishRequests(pubkey: string): Promise<Event[]> {
  const relay = await Relay.connect(RELAY)
  const found = await new Promise<Event[]>((resolve) => {
    const all: Event[] = []
    const sub = relay.subscribe([{ kinds: [62], authors: [pubkey] }], {
      onevent: (e) => all.push(e),
      oneose: () => {
        sub.close()
        resolve(all)
      },
    })
  })
  relay.close()
  return found
}

test('logging out from the profile page (the way out on phones)', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  // Phones have no sidebar; the header avatar opens the profile.
  await alice.page.getByRole('link', { name: 'Your profile' }).click()
  await alice.page.getByRole('button', { name: 'Log out' }).click()
  await alice.page.getByRole('button', { name: 'Log out' }).click() // confirm
  await expect(alice.page.getByRole('button', { name: /Private key/ })).toBeVisible()
  // Staying logged out after a reload.
  await goTo(alice, '/')
  await alice.page.reload()
  await expect(alice.page.getByRole('button', { name: /Private key/ })).toBeVisible()
  expectNoErrors(alice)
})

test("deleting your data: a warning first, then a request to vanish for Silvamor's relay, and you're signed out", async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  await alice.page.getByRole('link', { name: 'Your profile' }).click()
  await alice.page.getByRole('button', { name: 'Delete my data' }).click()
  const warning = alice.page.getByRole('alert')
  await expect(warning).toContainText("This can't be undone")
  await expect(warning).toContainText('All information stored about you on localhost:7777 will be wiped')

  // Cancelling changes nothing.
  await alice.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(warning).toBeHidden()
  expect(await vanishRequests(alice.pubkey)).toEqual([])

  await alice.page.getByRole('button', { name: 'Delete my data' }).click()
  await alice.page.getByRole('button', { name: 'Delete everything' }).click()
  await expect(alice.page.getByText('Your data was deleted from localhost:7777.')).toBeVisible()
  await expect(alice.page.getByRole('button', { name: /Private key/ })).toBeVisible()

  // One request, naming only Silvamor's relay; and this browser forgot Alice.
  const requests = await vanishRequests(alice.pubkey)
  expect(requests.map((e) => e.tags)).toEqual([[['relay', RELAY]]])
  expect(await alice.page.evaluate((pk) => Object.keys(localStorage).filter((k) => k.includes(pk) || k === 'silvamor:session'), alice.pubkey)).toEqual([])
  expectNoErrors(alice)
})
