import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAuthUrl } from './signers'

afterEach(() => vi.unstubAllGlobals())

describe("a signer app's approval page", () => {
  it('opens when it is a web page, and nothing else does', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    openAuthUrl('https://nsec.app/approve?id=1')
    openAuthUrl('http://localhost:5173/approve')
    for (const other of ['javascript:alert(1)', 'data:text/html,hi', 'http://signer.example/approve', 'nostrsigner:approve', 'not a url']) openAuthUrl(other)
    expect(open.mock.calls.map(([url]) => url)).toEqual(['https://nsec.app/approve?id=1', 'http://localhost:5173/approve'])
  })
})
