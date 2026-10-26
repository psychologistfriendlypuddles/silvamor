import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { securityHeaders } from '../../deploy/security-headers'

describe('deployment docs', () => {
  it('show exactly the security headers the end-to-end tests run under', () => {
    const doc = readFileSync(new URL('../../docs/DEPLOY.md', import.meta.url), 'utf8')
    for (const [name, value] of Object.entries(securityHeaders())) {
      expect(doc).toContain(`add_header ${name} "${value}" always;`)
    }
  })
})
