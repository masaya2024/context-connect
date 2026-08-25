import { describe, expect, it } from 'vitest'
import { githubSignature, verifyGitHubSignature } from '../src/webhook'

describe('GitHub webhook verification', () => {
  it('accepts only the HMAC of the exact raw payload', async () => {
    const signature = await githubSignature('secret', '{"ok":true}')
    expect(await verifyGitHubSignature('secret', '{"ok":true}', signature)).toBe(true)
    expect(await verifyGitHubSignature('secret', '{"ok":false}', signature)).toBe(false)
  })
})
