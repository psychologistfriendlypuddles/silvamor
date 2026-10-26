import { expect, test } from '@playwright/test'
import { createGame, expectNoErrors, goTo, joinGame, playOn, playerOnline, waitForStart, type Player } from './helpers'

async function startGame(browser: Parameters<typeof playerOnline>[0], game: 'Four-in-a-Row' | 'Dots and Boxes' | 'Chess') {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const path = await createGame(alice, { game, title: `${game} ${Date.now()}` })
  await goTo(bob, path)
  await joinGame(bob)
  const aliceFirst = await waitForStart(alice)
  await waitForStart(bob)
  return { alice, bob, first: aliceFirst ? alice : bob, second: aliceFirst ? bob : alice }
}

test('four-in-a-row: discs stack in a column and four in a row wins', async ({ browser }) => {
  const { alice, bob, first, second } = await startGame(browser, 'Four-in-a-Row')
  for (let i = 0; i < 3; i++) {
    await playOn(first, 'Column 1')
    await playOn(second, 'Column 2')
  }
  await playOn(first, 'Column 1') // fourth in column 1, stacked from the bottom
  await expect(first.page.getByText('You win! 🏆')).toBeVisible()
  await expect(second.page.getByText(/You lost this one/)).toBeVisible()
  expectNoErrors(alice, bob)
})

test('dots and boxes: completing a box scores it and earns another turn', async ({ browser }) => {
  const { alice, bob, first, second } = await startGame(browser, 'Dots and Boxes')
  // Top-left box on the default 8×8 board: top (line 1), bottom (line 9), left (line 73), right (line 74).
  await playOn(first, 'Line 1')
  await playOn(second, 'Line 9')
  await playOn(first, 'Line 73')
  await playOn(second, 'Line 74') // closes the box

  // The second player scored and goes again; the first waits.
  await expect(second.page.getByTitle('1 boxes')).toBeVisible()
  await expect(second.page.getByText('Your turn!')).toBeVisible()
  await expect(first.page.getByText('Waiting for your opponent…')).toBeVisible()
  await playOn(second, 'Line 2')
  await expect(first.page.getByText('Your turn!')).toBeVisible()
  expectNoErrors(alice, bob)
})

/** Chess: tap a piece's square, then its destination (squares are labelled "e2 white pawn", or just "e4"). */
async function chessMove(player: Player, from: string, to: string) {
  await expect(player.page.getByText('Your turn!')).toBeVisible()
  await player.page.getByRole('button', { name: new RegExp(`^${from} `) }).click()
  await player.page.getByRole('button', { name: new RegExp(`^${to}( |$)`) }).click()
}

test("chess: legal moves only, and fool's mate ends in checkmate", async ({ browser }) => {
  const { alice, bob, first: white, second: black } = await startGame(browser, 'Chess')

  // Black sees the board flipped: their pieces at the bottom.
  const firstSquare = (p: Player) => p.page.getByRole('button', { name: /^[a-h][1-8]/ }).first().getAttribute('aria-label')
  expect(await firstSquare(white)).toBe('a8 black rook')
  expect(await firstSquare(black)).toBe('h1 white rook')

  // An illegal destination does nothing: the pawn can't jump three squares.
  await white.page.getByRole('button', { name: /^e2 / }).click()
  await white.page.getByRole('button', { name: /^e5$/ }).click()
  await expect(white.page.getByText('Your turn!')).toBeVisible()

  await chessMove(white, 'f2', 'f3')
  await chessMove(black, 'e7', 'e5')
  await chessMove(white, 'g2', 'g4')
  await chessMove(black, 'd8', 'h4')
  await expect(black.page.getByText('Checkmate! You win! 🏆')).toBeVisible()
  await expect(white.page.getByText(/^Checkmate\. You lost this one/)).toBeVisible()
  expectNoErrors(alice, bob)
})

test('dots and boxes: choosing a bigger board', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const title = `Big board ${Date.now()}`
  const path = await createGame(alice, { game: 'Dots and Boxes', size: '8×8', title })
  await expect(alice.page.getByText('Dots and Boxes · 8×8')).toBeVisible()

  // The lobby card says how big the board is.
  await goTo(bob, '/')
  await expect(bob.page.getByRole('link', { name: new RegExp(title) }).getByText('· 8×8')).toBeVisible()

  await goTo(bob, path)
  await joinGame(bob)
  const aliceFirst = await waitForStart(alice)
  const first = aliceFirst ? alice : bob
  // 8×8 boxes: 2 × 8 × 9 = 144 lines, all playable.
  await expect(first.page.getByRole('button', { name: /^Line \d+$/ })).toHaveCount(144)
  await playOn(first, 'Line 144')
  await expect(first.page.getByText('Waiting for your opponent…')).toBeVisible()
  expectNoErrors(alice, bob)
})

test('dots and boxes on a phone: repeated missed taps suggest pinch-to-zoom, once', async ({ browser }) => {
  // Both on touch screens, so whoever moves first is a phone player.
  const alice = await playerOnline(browser, 'Alice', '/', { touch: true })
  const bob = await playerOnline(browser, 'Bob', '/', { touch: true })
  // 8×8: box centers are far enough from lines that Chrome's touch adjustment doesn't snap onto one.
  const path = await createGame(alice, { game: 'Dots and Boxes', size: '8×8' })
  await goTo(bob, path)
  await joinGame(bob)
  const first = (await waitForStart(alice)) ? alice : bob
  await waitForStart(bob)

  // Tap the middle of boxes: nowhere near an open line.
  const board = first.page.locator('main svg.w-full')
  const box = (await board.boundingBox())!
  const view = 8 * 100 + 60
  const boxCenter = (col: number, row: number) => ({ x: ((30 + col * 100 + 50) / view) * box.width, y: ((30 + row * 100 + 50) / view) * box.height })
  const tip = first.page.getByText('Tricky to hit a line?')

  await board.tap({ position: boxCenter(3, 3) })
  await board.tap({ position: boxCenter(5, 2) })
  await expect(tip).toHaveCount(0) // two misses: not yet
  await board.tap({ position: boxCenter(6, 6) })
  await expect(tip).toBeVisible()

  // Dismissed, it stays away for the rest of the game.
  await first.page.getByRole('button', { name: 'Dismiss tip' }).tap()
  for (const [c, r] of [[1, 1], [2, 2], [4, 4], [6, 5]]) await board.tap({ position: boxCenter(c, r) })
  await expect(tip).toHaveCount(0)
  await expect(first.page.getByText('Your turn!')).toBeVisible() // misses never make a move
  expectNoErrors(alice, bob)
})

test('dots and boxes with a mouse: missed clicks never show the touch tip', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice')
  const bob = await playerOnline(browser, 'Bob')
  const path = await createGame(alice, { game: 'Dots and Boxes' })
  await goTo(bob, path)
  await joinGame(bob)
  const first = (await waitForStart(alice)) ? alice : bob
  await waitForStart(bob)
  const board = first.page.locator('main svg.w-full')
  const box = (await board.boundingBox())!
  for (let i = 0; i < 4; i++) await board.click({ position: { x: box.width * (0.2 + i * 0.15), y: box.height * 0.5 + 3 } })
  await expect(first.page.getByText('Tricky to hit a line?')).toHaveCount(0)
  expectNoErrors(alice, bob)
})

test('dots and boxes on a phone, big board: tap a line, confirm it in the magnifier', async ({ browser }) => {
  const alice = await playerOnline(browser, 'Alice', '/', { touch: true })
  const bob = await playerOnline(browser, 'Bob', '/', { touch: true })
  const path = await createGame(alice, { game: 'Dots and Boxes', size: '12×12' })
  await goTo(bob, path)
  await joinGame(bob)
  const aliceFirst = await waitForStart(alice)
  await waitForStart(bob)
  const [first, second] = aliceFirst ? [alice, bob] : [bob, alice]
  const line = (p: Player, n: number) => p.page.getByRole('button', { name: `Line ${n}`, exact: true })

  // First tap only selects, opening the magnifier; nothing is drawn yet.
  await line(first, 1).tap()
  await expect(first.page.getByRole('button', { name: 'Confirm line 1' })).toBeVisible()
  await expect(first.page.getByText('Your turn!')).toBeVisible()

  // Tapping another line moves the selection; ✕ cancels it.
  await line(first, 2).tap()
  await expect(first.page.getByRole('button', { name: 'Confirm line 2' })).toBeVisible()
  await first.page.getByRole('button', { name: 'Cancel' }).tap()
  await expect(first.page.getByRole('button', { name: /^Confirm line/ })).toHaveCount(0)

  // Tapping the magnifier draws the line.
  await line(first, 2).tap()
  await first.page.getByRole('button', { name: 'Confirm line 2' }).tap()
  await expect(first.page.getByText('Waiting for your opponent…')).toBeVisible()
  await expect(line(first, 2)).toHaveCount(0) // drawn lines aren't buttons any more

  // Tapping the same line twice also confirms.
  await expect(second.page.getByText('Your turn!')).toBeVisible()
  await line(second, 30).tap()
  await line(second, 30).tap()
  await expect(second.page.getByText('Waiting for your opponent…')).toBeVisible()
  expectNoErrors(alice, bob)
})
