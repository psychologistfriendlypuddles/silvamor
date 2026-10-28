import { describe, expect, it } from 'vitest'
import { inApp } from './inApp'

const origin = 'https://www.silvamor.com'

describe('links in push notifications', () => {
  it('open pages of the app', () => {
    expect(inApp('https://www.silvamor.com/reminders', origin)).toBe('https://www.silvamor.com/reminders')
    expect(inApp('/leagues', origin)).toBe('https://www.silvamor.com/leagues')
    expect(inApp(undefined, origin)).toBe('https://www.silvamor.com/')
  })

  it('never go anywhere else', () => {
    for (const elsewhere of ['https://evil.example/', '//evil.example/x', 'https://www.silvamor.com.evil.example/', 'http://www.silvamor.com/', 'javascript:alert(1)', 'data:text/html,hi']) {
      expect(inApp(elsewhere, origin), elsewhere).toBe('https://www.silvamor.com/')
    }
  })
})
