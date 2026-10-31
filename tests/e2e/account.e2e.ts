import { expect, test } from '@playwright/test'
import { Relay } from 'nostr-tools/relay'
import type { Event } from 'nostr-tools/pure'
import { RELAY, expectNoErrors, goTo, holdRelay, login, newPlayer, playerOnline, seed } from './helpers'

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

/** `pubkey`'s newest event of `kind` on the test relay. */
async function newest(pubkey: string, kind: number): Promise<Event | undefined> {
  const relay = await Relay.connect(RELAY)
  const found = await new Promise<Event[]>((resolve) => {
    const all: Event[] = []
    const sub = relay.subscribe([{ kinds: [kind], authors: [pubkey] }], { onevent: (e) => all.push(e), oneose: () => (sub.close(), resolve(all)) })
  })
  relay.close()
  return found.sort((a, b) => b.created_at - a.created_at)[0]
}

test("saving a profile while the relays can't be checked for one changes nothing; once they can, it's loaded", async ({ browser }) => {
  // Dave has a profile, but profiles get no answer, as from relays that are down, until that's seen.
  const dave = await newPlayer(browser, 'Dave')
  await holdRelay(0, 60_000)
  const { page } = dave
  try {
    await login(dave, '/profile')
    await page.getByLabel('Username', { exact: true }).fill('Someone else')
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(
      page.getByText("Couldn't reach localhost:7777 to check for a profile you already have, so nothing was saved: it could have replaced it. Try again in a moment."),
    ).toBeVisible({ timeout: 20_000 })
  } finally {
    await holdRelay(0, 0)
  }
  expect(JSON.parse((await newest(dave.pubkey, 0))!.content).name).toBe('Dave')
  // With the relay answering again, saving finds his profile and loads it instead.
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Found your existing profile on the relays and loaded it. Check the form, then save again.')).toBeVisible()
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('Dave')
  expectNoErrors(dave)
})

test("saving a relay list while the relays can't be checked for one changes nothing; once they can, it's loaded", async ({ browser }) => {
  // Erin has a relay list (another room on the test relay), but relay lists get no answer until that's seen.
  const erin = await newPlayer(browser, 'Erin')
  const hers = `${RELAY}/erin`
  await seed({ sk: erin.sk, template: { kind: 10002, created_at: Math.floor(Date.now() / 1000), tags: [['r', hers]], content: '' } })
  await holdRelay(10002, 60_000)
  const { page } = erin
  try {
    await login(erin, '/relays')
    await page.getByLabel('Add a relay').fill(`${RELAY}/other`)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: 'Save relay list' }).click()
    await expect(
      page.getByText("Couldn't reach localhost:7777 to check for a relay list you already have, so nothing was saved: it could have replaced it. Try again in a moment."),
    ).toBeVisible({ timeout: 20_000 })
  } finally {
    await holdRelay(10002, 0)
  }
  expect((await newest(erin.pubkey, 10002))!.tags).toEqual([['r', hers]])
  // With the relay answering again, saving finds her list and loads it instead.
  await page.getByRole('button', { name: 'Save relay list' }).click()
  await expect(page.getByText('Found your existing relay list and loaded it instead. Make your changes again, then save.')).toBeVisible()
  await expect(page.getByText(hers, { exact: true })).toBeVisible()
  expectNoErrors(erin)
})
