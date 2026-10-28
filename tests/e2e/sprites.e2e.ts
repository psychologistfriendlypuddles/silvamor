import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { expectNoErrors, goTo, onPodium, playerOnline, publishRun, seed } from './helpers'

const OSTRICH_SHEET = fileURLToPath(new URL('../../public/sprites/ostrich.png', import.meta.url))

/** A blank RGBA PNG of `width`×`height` pixels: a few KB as a file, however big it is decoded. */
function blankPng(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
    return Buffer.concat([length, Buffer.from(type), data, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6], 8) // 8 bits per channel, RGBA
  const rows = Buffer.alloc(height * (1 + width * 4)) // each row: filter byte 0, then transparent pixels
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

test('uploading your own sprite: checked against the standard, then everyone sees it', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  await goTo(alice, '/profile')
  const card = alice.page.locator('main')
  await expect(card.getByRole('img', { name: 'Ostrich (idle)' }).first()).toBeVisible()
  await card.getByRole('button', { name: '▶ Strike' }).click()
  await expect(card.getByRole('img', { name: 'Ostrich (strike)' })).toBeVisible()

  await card.getByRole('button', { name: 'Upload your own sprite' }).click()
  await card.getByPlaceholder('Disco duck').fill('Test bird')
  await card.getByLabel('Sprite sheet').setInputFiles(OSTRICH_SHEET)
  // The template manifest wants 128px frames: too big for this 64px sheet.
  await expect(card.getByText(/needs a sheet of at least 512×1408px/)).toBeVisible()
  await card.getByLabel('Manifest').fill(JSON.stringify({ version: 1, size: 64, pixelated: true, animations: { idle: { row: 0, frames: 4, fps: 4 }, win: { row: 4, frames: 6, fps: 10 } } }))
  await expect(card.getByRole('img', { name: 'Test bird (idle)' })).toBeVisible()
  await card.getByRole('button', { name: 'Publish and use it' }).click()
  await expect(alice.page.getByText('Test bird is now your sprite ✨')).toBeVisible()

  // A friend sees Alice's new sprite on the podium once they've both played.
  await publishRun(alice.sk)
  const bob = await onPodium(browser, 'Bob', [alice.pubkey])
  await expect(bob.page.getByRole('img', { name: /^Test bird \((win|happy)\)$/ })).toBeVisible()
  expectNoErrors(alice, bob)
})

test("a sprite whose sheet is bigger than the standard allows shows as the ostrich, so it can't take a phone's memory", async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  // Published straight to the relay, as anyone could: the sprite maker itself refuses such a sheet.
  const upload = await fetch('http://localhost:7777/upload', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(blankPng(3000, 3000)) })
  const { url, sha256 } = (await upload.json()) as { url: string; sha256: string }
  await seed({
    sk: alice.sk,
    template: {
      kind: 30951,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({ version: 1, size: 64, animations: { idle: { row: 0, frames: 4, fps: 4 } } }),
      tags: [['d', 'huge'], ['title', 'Huge'], ['image', url], ['x', sha256], ['t', 'silvamor']],
    },
  })
  await goTo(alice, '/profile')
  await expect(alice.page.getByRole('button', { name: 'Use Huge' }).getByRole('img', { name: 'Ostrich (idle)' })).toBeVisible()
  expectNoErrors(alice)
})
